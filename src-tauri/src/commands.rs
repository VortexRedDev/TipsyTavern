//! Tauri 命令层：前端通过 `invoke('xxx', ...)` 调用这些函数。
//!
//! 关键命令：
//! - `generate`：触发一轮流式生成，HTTP 返回 request_id；流式 token 经
//!   `tipsy://generate` event 推回，payload = `{ request_id, event }`
//! - `list_providers`：列出已注册供应商（不含密钥）
//! - `set_api_key` / `delete_api_key` / `has_api_key`：密钥存取（走 OS keychain）
//! - `list_chats` / `load_chat` / `save_chat` / `delete_chat`：聊天持久化

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::ai::{AssistantMessageEvent, GenerateRequest, ProviderConfig, WorldBookSettings};
use crate::ai::context;
use crate::ai::keychain;
use crate::state::AppState;
use crate::storage::{CharacterData, CharacterIndexEntry, ChatData, ChatIndexEntry, PersonaData, PersonaIndexEntry};

const CHANNEL_GENERATE: &str = "tipsy://generate";

#[derive(Serialize, Clone)]
struct GeneratePayload {
    request_id: String,
    event: AssistantMessageEvent,
}

/// 触发一轮流式生成。返回 request_id；流式事件通过 `tipsy://generate` event 推回。
///
/// 错误策略：网络/上游错误不直接 break 命令，而是 emit 一个 `Error` 事件后结束流。
/// 命令本身只在请求级（如 provider 未注册 / 缺密钥）失败时返回 Err。
///
/// 如果请求带有 `character_id`，会在生成前执行上下文组装：
/// 加载角色数据 → 加载关联世界书 → 扫描/激活条目 → 组装 system prompt。
#[tauri::command]
pub async fn generate(
    app: AppHandle,
    state: State<'_, AppState>,
    mut request: GenerateRequest,
) -> Result<String, String> {
    let request_id = Uuid::new_v4().to_string();

    // ---- 上下文组装：角色 + 世界书 ----
    let mut inspector_character_name: Option<String> = None;
    let mut inspector_wi_activated: usize = 0;
    let mut inspector_wi_tokens: usize = 0;

    // Load persona + persona world book entries first (so we can merge with character entries)
    let settings = state.storage.load_settings().await.unwrap_or_default();
    let mut persona_text: Option<String> = None;
    let mut persona_book_entries: Vec<crate::storage::WorldBookEntry> = Vec::new();

    if let Some(active_persona_id) = settings.get("activePersonaId").and_then(|v| v.as_str()) {
        if let Ok(Some(persona)) = state.storage.load_persona(active_persona_id).await {
            if persona.position == "in_prompt" && !persona.description.trim().is_empty() {
                persona_text = Some(format!("[User: {}]\n{}", persona.name.trim(), persona.description.trim()));
            }
            if let Some(ref book_name) = persona.linked_world_book {
                if let Ok(pe) = state.storage.load_world_book(book_name).await {
                    persona_book_entries = pe;
                }
            }
        }
    }

    if let Some(ref char_id) = request.character_id {
        if let Ok(Some(character)) = state.storage.load_character(char_id).await {
            inspector_character_name = Some(character.name.clone());

            let (binding_primary, _auxiliary) = state
                .storage
                .get_character_world_books(char_id)
                .await
                .unwrap_or((None, Vec::new()));

            // Fall back to character card's linked_world_book if no binding exists
            let primary = binding_primary.or_else(|| character.linked_world_book.clone());

            let mut entries = if let Some(ref book_name) = primary {
                state.storage.load_world_book(book_name).await.unwrap_or_default()
            } else {
                Vec::new()
            };

            // Merge persona world book entries with character entries
            if !persona_book_entries.is_empty() {
                entries.extend(persona_book_entries);
            }

            let worldbook_settings = load_worldbook_settings(&state).await;

            let max_tokens = state
                .registry
                .get_model(&request.provider_id, &request.model_id)
                .map(|m| m.context_window as usize)
                .unwrap_or(128_000);

            if !entries.is_empty() {
                let assembled = context::assemble(
                    request.context.messages.clone(),
                    &character,
                    &entries,
                    &worldbook_settings,
                    max_tokens,
                );
                inspector_wi_activated = assembled.world_info.total_activated;
                inspector_wi_tokens = assembled.world_info.tokens_used;
                request.context = assembled.context;
            } else if request.context.system.is_none() {
                let (system, _) = build_character_system(&character);
                request.context.system = system;
            }
        }
    }

    // Prepend persona description to system prompt
    if let Some(pt) = persona_text {
        if pt.contains('\n') || !pt.is_empty() {
            let system = request.context.system.take();
            request.context.system = Some(match system {
                Some(s) => format!("{}\n\n{}", pt, s),
                None => pt,
            });
        }
    }

    // Capture inspector data before moving request into the spawned task
    let inspector_system = request.context.system.clone().unwrap_or_default();
    let inspector_messages = request.context.messages.clone();
    let inspector_model_id = request.model_id.clone();
    let inspector_provider_id = request.provider_id.clone();
    let inspector_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let registry = state.registry.clone();
    let app_c = app.clone();
    let rid = request_id.clone();

    tokio::spawn(async move {
        let (tx, mut rx) = mpsc::unbounded_channel::<AssistantMessageEvent>();

        // Emit inspector event before streaming
        let _ = tx.send(AssistantMessageEvent::Inspector {
            system_prompt: inspector_system,
            messages: inspector_messages,
            model_id: inspector_model_id,
            provider_id: inspector_provider_id,
            character_name: inspector_character_name,
            world_info_activated: inspector_wi_activated,
            world_info_tokens_used: inspector_wi_tokens,
            timestamp: inspector_ts,
        });

        // 在子任务里跑流式
        let _stream_task = tokio::spawn({
            let registry = registry.clone();
            let request = request.clone();
            let tx = tx.clone();
            async move {
                let result = registry.stream(&request, &tx).await;
                if let Err(e) = &result {
                    let _ = tx.send(AssistantMessageEvent::Error {
                        reason: "error".to_string(),
                        message: e.to_string(),
                    });
                }
            }
        });

        // 把事件 emit 给前端
        while let Some(ev) = rx.recv().await {
            let _ = app_c.emit(
                CHANNEL_GENERATE,
                GeneratePayload {
                    request_id: rid.clone(),
                    event: ev,
                },
            );
        }
    });

    Ok(request_id)
}

/// Load world book settings from settings.json, falling back to defaults.
async fn load_worldbook_settings(state: &State<'_, AppState>) -> WorldBookSettings {
    state
        .storage
        .load_settings()
        .await
        .ok()
        .and_then(|s| s.get("worldBookSettings").cloned())
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// Build a minimal system prompt from character data alone (no world book).
fn build_character_system(character: &CharacterData) -> (Option<String>, usize) {
    let mut parts: Vec<String> = Vec::new();
    if !character.system_prompt.trim().is_empty() {
        parts.push(character.system_prompt.trim().to_string());
    }
    if !character.description.trim().is_empty() {
        parts.push(format!("[Character: {}]", character.description.trim()));
    }
    if !character.personality.trim().is_empty() {
        parts.push(format!("[Personality: {}]", character.personality.trim()));
    }
    if !character.scenario.trim().is_empty() {
        parts.push(format!("[Scenario: {}]", character.scenario.trim()));
    }
    if parts.is_empty() {
        (None, 0)
    } else {
        let s = parts.join("\n\n");
        let len = s.len();
        (Some(s), len)
    }
}

/// 列出已注册供应商（不含密钥，密钥用 has_api_key 单独查询）。
#[tauri::command]
pub fn list_providers(state: State<'_, AppState>) -> Vec<ProviderConfig> {
    state.registry.list()
}

/// 是否已为该供应商配置密钥（以 OS keychain 为唯一真源）。
#[tauri::command]
pub fn has_api_key(provider_id: String) -> bool {
    keychain::get(&provider_id).map(|o| o.is_some()).unwrap_or(false)
}

/// 写入密钥（OS keychain）并同步注册表内存。
#[tauri::command]
pub fn set_api_key(
    provider_id: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    keychain::set(&provider_id, &key).map_err(|e| e.to_string())?;
    state
        .registry
        .set_provider_api_key(&provider_id, Some(key));
    Ok(())
}

/// 删除密钥。
#[tauri::command]
pub fn delete_api_key(provider_id: String, state: State<'_, AppState>) -> Result<(), String> {
    keychain::delete(&provider_id).map_err(|e| e.to_string())?;
    state
        .registry
        .set_provider_api_key(&provider_id, None);
    Ok(())
}

// ---- 聊天持久化命令 ----

/// 列出所有聊天（仅索引）。
#[tauri::command]
pub async fn list_chats(state: State<'_, AppState>) -> Result<Vec<ChatIndexEntry>, String> {
    state.storage.list_chats().await.map_err(|e| e.to_string())
}

/// 加载一个聊天的全部消息。
#[tauri::command]
pub async fn load_chat(
    chat_id: String,
    state: State<'_, AppState>,
) -> Result<Option<ChatData>, String> {
    state
        .storage
        .load_chat(&chat_id)
        .await
        .map_err(|e| e.to_string())
}

/// 保存聊天（全量写入）。
#[tauri::command]
pub async fn save_chat(
    chat: ChatData,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.storage.save_chat(&chat).await.map_err(|e| e.to_string())
}

/// 删除聊天。
#[tauri::command]
pub async fn delete_chat(
    chat_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .storage
        .delete_chat(&chat_id)
        .await
        .map_err(|e| e.to_string())
}

// ---- 供应商动态配置命令 ----

/// 更新供应商的 base URL（内存 + 持久化到 settings.json）。
#[tauri::command]
pub async fn update_provider_base_url(
    provider_id: String,
    base_url: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .registry
        .update_base_url(&provider_id, &base_url)
        .map_err(|e| e.to_string())?;
    // 持久化 provider 配置
    persist_provider_configs(&state).await
}

/// 更新供应商名称（内存 + 持久化到 settings.json）。
#[tauri::command]
pub async fn update_provider_name(
    provider_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.registry.update_name(&provider_id, &name).map_err(|e| e.to_string())?;
    persist_provider_configs(&state).await
}

/// 注册一个自定义供应商（内存 + 持久化到 settings.json）。
#[tauri::command]
pub async fn register_provider(
    provider: crate::ai::model::ProviderConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.registry.register(provider, None);
    persist_provider_configs(&state).await
}

/// 移除非内置供应商。
#[tauri::command]
pub async fn remove_provider(
    provider_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    const BUILTINS: &[&str] = &["openai", "anthropic", "google", "openrouter"];
    if BUILTINS.contains(&provider_id.as_str()) {
        return Err("Cannot remove built-in provider".into());
    }
    let _ = state.registry.remove(&provider_id);
    let _ = crate::ai::keychain::delete(&provider_id);
    persist_provider_configs(&state).await
}
/// 兼容 OpenAI / Ollama / vLLM 等标准 Chat Completions 端点。
#[tauri::command]
pub async fn fetch_models(
    base_url: String,
    api_key: String,
) -> Result<Vec<crate::ai::ModelDef>, String> {
    let base = base_url.trim_end_matches('/');
    let url = format!("{}/models", base);

    let mut headers = reqwest::header::HeaderMap::new();
    if !api_key.is_empty() && api_key != "ollama" {
        let bearer = format!("Bearer {}", api_key);
        headers.insert(
            reqwest::header::AUTHORIZATION,
            reqwest::header::HeaderValue::from_str(&bearer)
                .map_err(|e| e.to_string())?,
        );
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), body));
    }

    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("JSON parse: {}", e))?;

    // OpenAI 格式: { data: [{ id, ... }] }
    // Ollama 格式: { models: [{ name, ... }] }
    let models: Vec<crate::ai::ModelDef> = if let Some(data) = v.get("data").and_then(|x| x.as_array()) {
        // OpenAI / vLLM / 兼容格式
        data.iter()
            .filter_map(|m| {
                let id = m.get("id")?.as_str()?;
                Some(crate::ai::ModelDef {
                    id: id.to_string(),
                    name: id.to_string(),
                    api: None,
                    reasoning: id.to_lowercase().contains("o1")
                        || id.to_lowercase().contains("o3")
                        || id.to_lowercase().contains("reasoning"),
                    thinking_level_map: Default::default(),
                    context_window: 128_000,
                    max_tokens: 16_384,
                })
            })
            .collect()
    } else if let Some(data) = v.get("models").and_then(|x| x.as_array()) {
        // Ollama 格式
        data.iter()
            .filter_map(|m| {
                let id = m.get("name").or_else(|| m.get("id")).and_then(|x| x.as_str())?;
                Some(crate::ai::ModelDef {
                    id: id.to_string(),
                    name: id.to_string(),
                    api: None,
                    reasoning: false,
                    thinking_level_map: Default::default(),
                    context_window: 128_000,
                    max_tokens: 16_384,
                })
            })
            .collect()
    } else {
        // 尝试返回整个响应作为 fallback
        return Err("Unrecognized /models response format".into());
    };

    Ok(models)
}

/// 用获取的模型列表更新供应商（内存 + 持久化到 settings.json）。
#[tauri::command]
pub async fn update_provider_models(
    provider_id: String,
    models: Vec<crate::ai::ModelDef>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .registry
        .update_models(&provider_id, models)
        .map_err(|e| e.to_string())?;
    // 持久化 provider 配置
    persist_provider_configs(&state).await
}

/// 把当前内存中的 provider 配置写入 settings.json
async fn persist_provider_configs(state: &State<'_, AppState>) -> Result<(), String> {
    let mut settings = state.storage.load_settings().await.map_err(|e| e.to_string())?;
    let providers: Vec<serde_json::Value> = state
        .registry
        .list()
        .into_iter()
        .map(|p| serde_json::json!({
            "id": p.id,
            "name": p.name,
            "base_url": p.base_url,
            "models": p.models.iter().map(|m| serde_json::json!({
                "id": m.id,
                "name": m.name,
                "context_window": m.context_window,
                "max_tokens": m.max_tokens,
                "reasoning": m.reasoning,
            })).collect::<Vec<_>>(),
        }))
        .collect();
    settings["providers"] = serde_json::json!(providers);
    state.storage.save_settings(&settings).await.map_err(|e| e.to_string())
}

// ---- 角色卡命令 ----

/// 列出所有角色（仅索引）
#[tauri::command]
pub async fn list_characters(
    state: State<'_, AppState>,
) -> Result<Vec<CharacterIndexEntry>, String> {
    state.storage.list_characters().await.map_err(|e| e.to_string())
}

/// 加载一个角色的完整数据
#[tauri::command]
pub async fn load_character(
    char_id: String,
    state: State<'_, AppState>,
) -> Result<Option<CharacterData>, String> {
    state.storage.load_character(&char_id).await.map_err(|e| e.to_string())
}

/// 保存角色（创建或更新）
#[tauri::command]
pub async fn save_character(
    character: CharacterData,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.storage.save_character(&character).await.map_err(|e| e.to_string())
}

/// 删除角色
#[tauri::command]
pub async fn delete_character(
    char_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.storage.delete_character(&char_id).await.map_err(|e| e.to_string())
}

// ---- 世界书命令 ----

/// 列出所有世界书名称
#[tauri::command]
pub async fn list_world_books(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    state.storage.list_world_books().await.map_err(|e| e.to_string())
}

/// 获取角色关联的世界书（先查本地绑定表 → 没有则查 PNG 内嵌）
#[tauri::command]
pub async fn get_character_world_books(
    char_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let (primary, auxiliary) = state.storage.get_character_world_books(&char_id).await.map_err(|e| e.to_string())?;

    if primary.is_some() || !auxiliary.is_empty() {
        return Ok(serde_json::json!({"primary": primary, "auxiliary": auxiliary, "source": "binding"}));
    }

    if let Some(character) = state.storage.load_character(&char_id).await.map_err(|e| e.to_string())? {
        if let Some(native) = character.linked_world_book {
            let books = state.storage.list_world_books().await.map_err(|e| e.to_string())?;
            if books.contains(&native) {
                return Ok(serde_json::json!({"primary": native, "auxiliary": [], "source": "native"}));
            }
        }
    }

    Ok(serde_json::json!({"primary": null, "auxiliary": [], "source": "none"}))
}

/// 设置角色主世界书（写入本地绑定表，不动 PNG）
#[tauri::command]
pub async fn set_character_world_book(
    char_id: String,
    world_book: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.storage.set_character_primary_world(&char_id, world_book).await.map_err(|e| e.to_string())
}

/// 加载世界书条目
#[tauri::command]
pub async fn load_world_book(
    name: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::storage::WorldBookEntry>, String> {
    state.storage.load_world_book(&name).await.map_err(|e| e.to_string())
}

/// 保存世界书条目（全量覆写）
#[tauri::command]
pub async fn save_world_book_entries(
    name: String,
    entries: Vec<crate::storage::WorldBookEntry>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.storage.save_world_book(&name, &entries).await.map_err(|e| e.to_string())
}

/// 重命名世界书（读旧→写新→删旧→更新角色绑定）
#[tauri::command]
pub async fn rename_world_book(
    old_name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let entries = state.storage.load_world_book(&old_name).await.map_err(|e| e.to_string())?;
    state.storage.save_world_book(&new_name, &entries).await.map_err(|e| e.to_string())?;
    let old_path = state.storage.world_book_path(&old_name);
    if old_path.exists() {
        tokio::fs::remove_file(&old_path).await.map_err(|e| e.to_string())?;
    }
    // Update character bindings that reference the old name
    let bindings = state.storage.load_world_bindings().await.map_err(|e| e.to_string())?;
    for b in &bindings {
        if b.primary.as_deref() == Some(&old_name) {
            state.storage.set_character_primary_world(&b.character_id, Some(new_name.clone())).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 保存应用设置（merge 模式：只更新传入的字段，不覆盖已有字段）。
#[tauri::command]
pub async fn save_app_settings(
    settings: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut existing = state.storage.load_settings().await.map_err(|e| e.to_string())?;
    if let (serde_json::Value::Object(existing_map), serde_json::Value::Object(incoming_map)) = (&mut existing, &settings) {
        for (k, v) in incoming_map {
            existing_map.insert(k.clone(), v.clone());
        }
    } else {
        existing = settings;
    }
    state.storage.save_settings(&existing).await.map_err(|e| e.to_string())
}

/// 加载应用设置
#[tauri::command]
pub async fn load_app_settings(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    state.storage.load_settings().await.map_err(|e| e.to_string())
}

/// 删除世界书
#[tauri::command]
pub async fn delete_world_book(
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = state.storage.world_book_path(&name);
    if path.exists() {
        tokio::fs::remove_file(&path).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 导入角色卡（从文件路径）。
/// PNG 文件会被直接复制到 characters/ 目录作为角色文件（ST 兼容）。
/// 如果角色卡内嵌了 character_book，自动导入为世界书并关联。
#[tauri::command]
pub async fn import_character(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<CharacterData, String> {
    let mut character = crate::character::import_from_path(&file_path)
        .map_err(|e| e.to_string())?;

    // 如果有嵌入的世界书，自动导入并建立本地绑定
    if let Some(book_name) = crate::character::import_embedded_world_book(
        &file_path, &character, &state.storage,
    ).await.map_err(|e| e.to_string())? {
        // 写入本地绑定表（不污染 PNG 里 linked_world_book 字段）
        state.storage.set_character_primary_world(&character.id, Some(book_name.clone()))
            .await.map_err(|e| e.to_string())?;
        character.linked_world_book = Some(book_name);
    }

    // 直接复制 PNG 到 data/characters/ 目录作为角色文件
    let src = std::path::Path::new(&file_path);
    let chars_dir = state.storage.data_dir().join("characters");
    if src.extension().and_then(|e| e.to_str()) == Some("png") {
        tokio::fs::create_dir_all(&chars_dir).await.map_err(|e| e.to_string())?;
        let dest = chars_dir.join(format!("{}.png", character.id));
        tokio::fs::copy(src, &dest).await.map_err(|e| e.to_string())?;
        character.avatar_path = Some(dest.to_string_lossy().to_string());
    } else if src.extension().and_then(|e| e.to_str()) == Some("json") {
        state.storage.save_character(&character).await.map_err(|e| e.to_string())?;
        let png_path = chars_dir.join(format!("{}.png", character.id));
        character.avatar_path = Some(png_path.to_string_lossy().to_string());
    }

    Ok(character)
}

/// 测试供应商连通性。调 GET /models，看 HTTP 状态码。
/// 返回 (ok, detail)。
#[tauri::command]
pub async fn test_connection(
    base_url: String,
    api_key: String,
) -> Result<(bool, String), String> {
    let base = base_url.trim_end_matches('/');
    let url = format!("{}/models", base);

    let mut headers = reqwest::header::HeaderMap::new();
    if !api_key.is_empty()
        && api_key != "ollama"
        && !base.contains("localhost")
        && !base.contains("127.0.0.1")
    {
        let bearer = format!("Bearer {}", api_key);
        headers.insert(
            reqwest::header::AUTHORIZATION,
            reqwest::header::HeaderValue::from_str(&bearer)
                .map_err(|e| e.to_string())?,
        );
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    match client.get(&url).headers(headers).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            if status == 200 {
                Ok((true, format!("HTTP 200 — 连通正常")))
            } else if status == 401 || status == 403 {
                Ok((false, format!("HTTP {} — 鉴权失败，请检查 API Key", status)))
            } else if status == 404 {
                Ok((false, format!("HTTP 404 — /models 端点不存在，但 Base URL 可达")))
            } else {
                let body = resp.text().await.unwrap_or_default();
                Ok((false, format!("HTTP {} — {}", status, &body[..body.len().min(200)])))
            }
        }
        Err(e) => {
            if e.is_timeout() {
                Ok((false, "连接超时 — 请检查 Base URL 是否正确".into()))
            } else if e.is_connect() {
                Ok((false, format!("连接失败 — {}", e)))
            } else {
                Ok((false, format!("网络错误 — {}", e)))
            }
        }
    }
}

// ---- 人设（Persona）命令 ----

#[tauri::command]
pub async fn list_personas(
    state: State<'_, AppState>,
) -> Result<Vec<PersonaIndexEntry>, String> {
    state.storage.list_personas().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_persona(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<PersonaData>, String> {
    state.storage.load_persona(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_persona(
    persona: PersonaData,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.storage.save_persona(&persona).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_persona(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.storage.delete_persona(&id).await.map_err(|e| e.to_string())
}