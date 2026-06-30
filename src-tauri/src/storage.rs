//! JSONL 平面文件存储 —— 聊天消息持久化。
//!
//! 目录结构（与 SillyTavern 对齐）：
//! ```text
//! {app_data}/TipsyTavern/
//!   chats/
//!     {chat_id}.jsonl        # 一个聊天一个文件，每行一条消息
//!     _index.json             # 聊天索引 [{id, title, character_id, created_at, updated_at}]
//!   characters/              # 角色卡（Phase 1 后续）
//!   presets/                 # AI 预设（Phase 2）
//!   world_info/              # 世界书（Phase 2）
//! ```
//!
//! JSONL 格式：每行一个 serde_json Value，代表一条消息。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};

use crate::ai::model::CharacterMessage;

/// 聊天索引条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatIndexEntry {
    pub id: String,
    pub title: String,
    pub character_id: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// 聊天完整数据（索引 + 消息列表）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatData {
    pub id: String,
    pub title: String,
    pub character_id: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub messages: Vec<CharacterMessage>,
}

/// 存储管理器
pub struct Storage {
    base_dir: PathBuf,
}

impl Storage {
    /// 创建存储实例。
    /// - 默认数据目录：Tauri 自动分配
    /// - 可通过该目录下的 `config.yaml` 中 `dataRoot` 字段自定义
    pub fn new(app_data_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&app_data_dir);
        let base_dir = Self::resolve_data_dir(&app_data_dir);
        Self { base_dir }
    }

    /// 获取当前数据目录
    pub fn data_dir(&self) -> &PathBuf {
        &self.base_dir
    }

    /// 从 config.yaml 解析自定义数据目录，没有则用默认值
    fn resolve_data_dir(default_dir: &PathBuf) -> PathBuf {
        let config_path = default_dir.join("config.yaml");
        if config_path.exists() {
            if let Ok(data) = std::fs::read_to_string(&config_path) {
                for line in data.lines() {
                    let trimmed = line.trim();
                    if let Some(value) = trimmed.strip_prefix("dataRoot:") {
                        let dir = value.trim().trim_matches('"').trim_matches('\'');
                        let path = PathBuf::from(dir);
                        if path.exists() || std::fs::create_dir_all(&path).is_ok() {
                            return path;
                        }
                    }
                }
            }
        }
        default_dir.clone()
    }

    /// 初始化目录结构
    #[allow(dead_code)]
    pub async fn ensure_dirs(&self) -> std::io::Result<()> {
        let chats_dir = self.base_dir.join("chats");
        tokio::fs::create_dir_all(&chats_dir).await?;
        Ok(())
    }

    fn chats_dir(&self) -> PathBuf {
        self.base_dir.join("chats")
    }

    fn index_path(&self) -> PathBuf {
        self.chats_dir().join("_index.json")
    }

    fn chat_path(&self, chat_id: &str) -> PathBuf {
        // 防止路径穿越
        let safe = chat_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect::<String>();
        self.chats_dir().join(format!("{}.jsonl", safe))
    }

    // ---- 索引操作 ----

    pub async fn load_index(&self) -> std::io::Result<Vec<ChatIndexEntry>> {
        let path = self.index_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let data = tokio::fs::read_to_string(&path).await?;
        let entries: Vec<ChatIndexEntry> =
            serde_json::from_str(&data).unwrap_or_default();
        Ok(entries)
    }

    async fn save_index(&self, entries: &[ChatIndexEntry]) -> std::io::Result<()> {
        let path = self.index_path();
        let json = serde_json::to_string_pretty(entries)?;
        tokio::fs::write(&path, json).await?;
        Ok(())
    }

    // ---- 聊天操作 ----

    /// 列出所有聊天（仅索引）
    pub async fn list_chats(&self) -> std::io::Result<Vec<ChatIndexEntry>> {
        self.load_index().await
    }

    /// 加载一个聊天的全部消息
    pub async fn load_chat(&self, chat_id: &str) -> std::io::Result<Option<ChatData>> {
        let index = self.load_index().await?;
        let entry = match index.iter().find(|e| e.id == chat_id) {
            Some(e) => e.clone(),
            None => return Ok(None),
        };

        let path = self.chat_path(chat_id);
        if !path.exists() {
            return Ok(None);
        }

        let file = tokio::fs::File::open(&path).await?;
        let reader = BufReader::new(file);
        let mut lines = reader.lines();
        let mut messages = Vec::new();

        while let Some(line) = lines.next_line().await? {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(msg) = serde_json::from_str::<CharacterMessage>(&line) {
                messages.push(msg);
            }
        }

        Ok(Some(ChatData {
            id: entry.id,
            title: entry.title,
            character_id: entry.character_id,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            messages,
        }))
    }

    /// 保存聊天（全量写入）
    pub async fn save_chat(&self, chat: &ChatData) -> std::io::Result<()> {
        // 确保目录存在
        tokio::fs::create_dir_all(self.chats_dir()).await?;

        // 写入 JSONL
        let path = self.chat_path(&chat.id);
        let file = tokio::fs::File::create(&path).await?;
        let mut writer = BufWriter::new(file);
        for msg in &chat.messages {
            let line = serde_json::to_string(msg)?;
            writer.write_all(line.as_bytes()).await?;
            writer.write_all(b"\n").await?;
        }
        writer.flush().await?;

        // 更新索引
        let mut index = self.load_index().await?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        if let Some(existing) = index.iter_mut().find(|e| e.id == chat.id) {
            existing.title = chat.title.clone();
            existing.character_id = chat.character_id.clone();
            existing.updated_at = now;
        } else {
            index.push(ChatIndexEntry {
                id: chat.id.clone(),
                title: chat.title.clone(),
                character_id: chat.character_id.clone(),
                created_at: chat.created_at,
                updated_at: now,
            });
        }
        self.save_index(&index).await?;

        Ok(())
    }

    /// 删除聊天
    pub async fn delete_chat(&self, chat_id: &str) -> std::io::Result<()> {
        let path = self.chat_path(chat_id);
        if path.exists() {
            tokio::fs::remove_file(&path).await?;
        }

        let mut index = self.load_index().await?;
        index.retain(|e| e.id != chat_id);
        self.save_index(&index).await?;

        Ok(())
    }

    // ---- 角色卡操作 ----

    fn characters_dir(&self) -> PathBuf {
        self.base_dir.join("characters")
    }

    fn char_png_path(&self, char_id: &str) -> PathBuf {
        let safe = char_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect::<String>();
        self.characters_dir().join(format!("{}.png", safe))
    }

    fn char_overlay_path(&self, char_id: &str) -> PathBuf {
        let safe = char_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect::<String>();
        self.characters_dir().join(format!("{}.json", safe))
    }

    /// 列出所有角色：扫描 characters/ 目录下的 PNG 文件，从 tEXt chunk 提取名称
    pub async fn list_characters(&self) -> std::io::Result<Vec<CharacterIndexEntry>> {
        let dir = self.characters_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut entries = Vec::new();
        let mut read_dir = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = read_dir.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("png") {
                continue;
            }
            let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown").to_string();

            // 快速解析 tEXt chunk 获取名称
            if let Ok(data) = tokio::fs::read(&path).await {
                if let Some(json_str) = crate::character::extract_png_text_chunk_raw(&data, "chara")
                    .or_else(|| crate::character::extract_png_text_chunk_raw(&data, "ccv3"))
                {
                    // base64 decode
                    use base64::Engine;
                    let engine = base64::engine::general_purpose::STANDARD;
                    let name = if let Ok(bytes) = engine.decode(json_str.as_bytes()) {
                        let text = String::from_utf8_lossy(&bytes);
                        serde_json::from_str::<serde_json::Value>(&text)
                            .ok()
                            .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                            .unwrap_or_else(|| id.clone())
                    } else {
                        id.clone()
                    };

                    let meta = std::fs::metadata(&path).ok();
                    let ts = meta.and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);

                    entries.push(CharacterIndexEntry {
                        id,
                        name,
                        kind: "ai".into(),
                        created_at: ts,
                        updated_at: ts,
                    });
                }
            }
        }
        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(entries)
    }

    /// 加载角色完整数据：先解析 PNG，再用 JSON overlay 覆盖编辑字段。
    pub async fn load_character(&self, char_id: &str) -> std::io::Result<Option<CharacterData>> {
        let path = self.char_png_path(char_id);
        if !path.exists() {
            return Ok(None);
        }
        let data = tokio::fs::read(&path).await?;
        let mut ch = match crate::character::parse_png_bytes(&data) {
            Ok(ch) => ch,
            Err(_) => return Ok(None),
        };
        ch.avatar_path = Some(path.to_string_lossy().to_string());
        ch.id = char_id.to_string();

        // Merge JSON overlay if exists
        let overlay_path = self.char_overlay_path(char_id);
        if overlay_path.exists() {
            if let Ok(overlay_json) = tokio::fs::read_to_string(&overlay_path).await {
                if let Ok(overlay) = serde_json::from_str::<CharacterData>(&overlay_json) {
                    merge_overlay(&mut ch, overlay);
                }
            }
        }

        Ok(Some(ch))
    }
}

fn merge_overlay(base: &mut CharacterData, overlay: CharacterData) {
    if !overlay.name.is_empty() { base.name = overlay.name; }
    if !overlay.description.is_empty() { base.description = overlay.description; }
    if !overlay.personality.is_empty() { base.personality = overlay.personality; }
    if !overlay.scenario.is_empty() { base.scenario = overlay.scenario; }
    if !overlay.first_message.is_empty() { base.first_message = overlay.first_message; }
    if !overlay.system_prompt.is_empty() { base.system_prompt = overlay.system_prompt; }
    if !overlay.tags.is_empty() { base.tags = overlay.tags; }
    if !overlay.creator.is_empty() { base.creator = overlay.creator; }
    if !overlay.version.is_empty() { base.version = overlay.version; }
    if !overlay.kind.is_empty() { base.kind = overlay.kind; }
    if !overlay.alternate_greetings.is_empty() { base.alternate_greetings = overlay.alternate_greetings; }
    if !overlay.example_messages.is_empty() { base.example_messages = overlay.example_messages; }
    if overlay.linked_world_book.is_some() { base.linked_world_book = overlay.linked_world_book; }
}

impl Storage {
    pub async fn save_character(&self, character: &CharacterData) -> std::io::Result<()> {
        tokio::fs::create_dir_all(self.characters_dir()).await?;
        let path = self.char_overlay_path(&character.id);
        let json = serde_json::to_string_pretty(character)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        tokio::fs::write(&path, json).await
    }

    /// 获取角色 PNG 文件的路径
    #[allow(dead_code)]
    pub fn character_avatar_path(&self, char_id: &str) -> PathBuf {
        self.char_png_path(char_id)
    }

    // ---- 角色-世界书绑定 ----

    fn world_bindings_path(&self) -> PathBuf {
        self.base_dir.join("world_bindings.json")
    }

    /// 加载所有角色-世界书绑定关系
    pub async fn load_world_bindings(&self) -> std::io::Result<Vec<CharacterWorldBinding>> {
        let path = self.world_bindings_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let data = tokio::fs::read_to_string(&path).await?;
        Ok(serde_json::from_str(&data).unwrap_or_default())
    }

    /// 保存角色-世界书绑定关系
    async fn save_world_bindings(&self, bindings: &[CharacterWorldBinding]) -> std::io::Result<()> {
        let path = self.world_bindings_path();
        let json = serde_json::to_string_pretty(bindings)?;
        tokio::fs::write(&path, json).await?;
        Ok(())
    }

    /// 获取某个角色绑定的世界书（主世界书 + 附属世界书）
    pub async fn get_character_world_books(&self, char_id: &str) -> std::io::Result<(Option<String>, Vec<String>)> {
        let bindings = self.load_world_bindings().await?;
        for b in &bindings {
            if b.character_id == char_id {
                return Ok((b.primary.clone(), b.auxiliary.clone()));
            }
        }
        Ok((None, Vec::new()))
    }

    /// 设置角色绑定的主世界书
    pub async fn set_character_primary_world(&self, char_id: &str, world_name: Option<String>) -> std::io::Result<()> {
        let mut bindings = self.load_world_bindings().await?;
        if let Some(existing) = bindings.iter_mut().find(|b| b.character_id == char_id) {
            existing.primary = world_name;
        } else {
            bindings.push(CharacterWorldBinding {
                character_id: char_id.to_string(),
                primary: world_name,
                auxiliary: Vec::new(),
            });
        }
        // 清理空记录
        bindings.retain(|b| b.primary.is_some() || !b.auxiliary.is_empty());
        self.save_world_bindings(&bindings).await?;
        Ok(())
    }

        // ---- 应用设置持久化 ----

    fn settings_path(&self) -> PathBuf {
        self.data_dir().join("settings.json")
    }

    pub async fn load_settings(&self) -> std::io::Result<serde_json::Value> {
        let path = self.settings_path();
        if !path.exists() {
            return Ok(serde_json::json!({}));
        }
        let data = tokio::fs::read_to_string(&path).await?;
        Ok(serde_json::from_str(&data).unwrap_or(serde_json::json!({})))
    }

    pub async fn save_settings(&self, settings: &serde_json::Value) -> std::io::Result<()> {
        let path = self.settings_path();
        let json = serde_json::to_string_pretty(settings)?;
        tokio::fs::write(&path, json).await?;
        Ok(())
    }

    /// 删除角色及其 overlay
    pub async fn delete_character(&self, char_id: &str) -> std::io::Result<()> {
        let path = self.char_png_path(char_id);
        if path.exists() {
            tokio::fs::remove_file(&path).await?;
        }
        let overlay = self.char_overlay_path(char_id);
        if overlay.exists() {
            tokio::fs::remove_file(&overlay).await?;
        }
        Ok(())
    }

    // ---- 世界书操作 ----

    fn world_info_dir(&self) -> PathBuf {
        self.base_dir.join("world_info")
    }

    pub fn world_book_path(&self, name: &str) -> PathBuf {
        let safe = name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == ' ')
            .collect::<String>()
            .replace(' ', "_");
        self.world_info_dir().join(format!("{}.json", safe))
    }

    /// 列出所有世界书名称
    pub async fn list_world_books(&self) -> std::io::Result<Vec<String>> {
        let dir = self.world_info_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut names = Vec::new();
        let mut read_dir = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = read_dir.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
                    names.push(name.replace('_', " "));
                }
            }
        }
        Ok(names)
    }

    /// 保存世界书
    pub async fn save_world_book(&self, name: &str, entries: &[WorldBookEntry]) -> std::io::Result<()> {
        tokio::fs::create_dir_all(self.world_info_dir()).await?;
        let path = self.world_book_path(name);
        let json = serde_json::to_string_pretty(entries)?;
        tokio::fs::write(&path, json).await?;
        Ok(())
    }

    /// 加载世界书条目
    #[allow(dead_code)]
    pub async fn load_world_book(&self, name: &str) -> std::io::Result<Vec<WorldBookEntry>> {
        let path = self.world_book_path(name);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let data = tokio::fs::read_to_string(&path).await?;
        Ok(serde_json::from_str(&data).unwrap_or_default())
    }

    // ---- 人设（Persona）操作 ----

    fn personas_dir(&self) -> PathBuf {
        self.base_dir.join("personas")
    }

    fn persona_index_path(&self) -> PathBuf {
        self.personas_dir().join("_index.json")
    }

    fn persona_path(&self, id: &str) -> PathBuf {
        let safe = id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect::<String>();
        self.personas_dir().join(format!("{}.json", safe))
    }

    pub async fn list_personas(&self) -> std::io::Result<Vec<PersonaIndexEntry>> {
        let path = self.persona_index_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let data = tokio::fs::read_to_string(&path).await?;
        Ok(serde_json::from_str(&data).unwrap_or_default())
    }

    async fn save_persona_index(&self, entries: &[PersonaIndexEntry]) -> std::io::Result<()> {
        tokio::fs::create_dir_all(self.personas_dir()).await?;
        let json = serde_json::to_string_pretty(entries)?;
        tokio::fs::write(self.persona_index_path(), json).await?;
        Ok(())
    }

    pub async fn load_persona(&self, id: &str) -> std::io::Result<Option<PersonaData>> {
        let path = self.persona_path(id);
        if !path.exists() {
            return Ok(None);
        }
        let data = tokio::fs::read_to_string(&path).await?;
        Ok(serde_json::from_str(&data).ok())
    }

    pub async fn save_persona(&self, persona: &PersonaData) -> std::io::Result<()> {
        tokio::fs::create_dir_all(self.personas_dir()).await?;
        let path = self.persona_path(&persona.id);
        let json = serde_json::to_string_pretty(persona)?;
        tokio::fs::write(&path, json).await?;

        let mut index = self.list_personas().await?;
        if let Some(existing) = index.iter_mut().find(|e| e.id == persona.id) {
            existing.name = persona.name.clone();
            existing.updated_at = persona.updated_at;
        } else {
            index.push(PersonaIndexEntry {
                id: persona.id.clone(),
                name: persona.name.clone(),
                created_at: persona.created_at,
                updated_at: persona.updated_at,
            });
        }
        self.save_persona_index(&index).await?;
        Ok(())
    }

    pub async fn delete_persona(&self, id: &str) -> std::io::Result<()> {
        let path = self.persona_path(id);
        if path.exists() {
            tokio::fs::remove_file(&path).await?;
        }
        let mut index = self.list_personas().await?;
        index.retain(|e| e.id != id);
        self.save_persona_index(&index).await?;
        Ok(())
    }
}

// ---- 角色卡数据类型 ----

/// 角色索引条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterIndexEntry {
    pub id: String,
    pub name: String,
    pub kind: String, // "ai" | "user"
    pub created_at: u64,
    pub updated_at: u64,
}

/// 角色完整数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterData {
    pub id: String,
    pub name: String,
    pub description: String,
    pub personality: String,
    pub scenario: String,
    pub first_message: String,
    pub alternate_greetings: Vec<String>,
    pub example_messages: String,
    pub system_prompt: String,
    pub tags: Vec<String>,
    pub creator: String,
    pub version: String,
    pub kind: String, // "ai" | "user"
    pub icon: String,  // Material Symbols 名称
    pub avatar_path: Option<String>, // 角色 PNG 头像路径
    pub linked_world_book: Option<String>, // 关联的世界书名称
    pub created_at: u64,
    pub updated_at: u64,
}

/// 世界书条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldBookEntry {
    pub id: u32,
    pub keys: Vec<String>,
    pub secondary_keys: Vec<String>,
    pub comment: String,
    pub content: String,
    pub constant: bool,
    pub selective: bool,
    #[serde(default)]
    pub selective_logic: u8,
    pub insertion_order: u32,
    pub enabled: bool,
    pub position: String,
}

/// 角色-世界书绑定关系
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterWorldBinding {
    pub character_id: String,
    pub primary: Option<String>,     // 主世界书
    pub auxiliary: Vec<String>,      // 附属世界书列表
}

/// 用户人设（Persona）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaData {
    pub id: String,
    pub name: String,
    pub description: String,
    pub avatar_path: Option<String>,
    pub position: String,
    pub linked_world_book: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

/// 人设索引条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaIndexEntry {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub updated_at: u64,
}
