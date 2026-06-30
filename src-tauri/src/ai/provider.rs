//! Provider 注册表：把已注册供应商与解析出的密钥绑在一起，
//! 并按 `api` 家族分发到对应 streamSimple 实现。
//!
//! 内置 6 家默认供应商；用户可经 IPC 注册自定义供应商。
//! 密钥来自 OS keychain（见 `keychain.rs`），不入注册表明文。

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::mpsc::UnboundedSender;

use crate::ai::error::ProviderError;
use crate::ai::event::AssistantMessageEvent;
use crate::ai::model::{
    ApiFamily, ModelDef, ProviderConfig, MaxTokensField, GenerateRequest,
};

/// 一个已注册的供应商：配置 + 内存中的密钥（实际存 keychain）。
pub struct LlmProvider {
    cfg: ProviderConfig,
    api_key: Mutex<Option<String>>,
}

impl LlmProvider {
    pub fn new(cfg: ProviderConfig, api_key: Option<String>) -> Self {
        Self {
            cfg,
            api_key: Mutex::new(api_key),
        }
    }

    pub fn cfg(&self) -> &ProviderConfig {
        &self.cfg
    }

    pub fn cfg_mut(&mut self) -> &mut ProviderConfig {
        &mut self.cfg
    }

    pub fn api_key(&self) -> Option<String> {
        self.api_key.lock().unwrap().clone()
    }

    pub fn set_api_key(&self, key: Option<String>) {
        *self.api_key.lock().unwrap() = key;
    }
}

/// 全局 Provider 注册表。Tauri 通过 State 共享。
pub struct ProviderRegistry {
    providers: Mutex<HashMap<String, LlmProvider>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: Mutex::new(HashMap::new()),
        }
    }

    /// 注册/覆盖一个供应商。`api_key` 可为 None（后由 `set_api_key` 写入 keychain）。
    pub fn register(&self, cfg: ProviderConfig, api_key: Option<String>) {
        self.providers
            .lock()
            .unwrap()
            .insert(cfg.id.clone(), LlmProvider::new(cfg, api_key));
    }

    /// 密钥写入 keychain 后调用，同步内存中的 key。
    pub fn set_provider_api_key(&self, provider_id: &str, key: Option<String>) {
        if let Some(p) = self.providers.lock().unwrap().get(provider_id) {
            p.set_api_key(key);
        }
    }

    /// 更新供应商 base URL（内存）。
    pub fn update_base_url(&self, provider_id: &str, base_url: &str) -> Result<(), ProviderError> {
        let mut lock = self.providers.lock().unwrap();
        let p = lock
            .get_mut(provider_id)
            .ok_or_else(|| ProviderError::NotFound(provider_id.to_string()))?;
        p.cfg_mut().base_url = base_url.to_string();
        Ok(())
    }

    /// 更新供应商名称（内存）。
    pub fn update_name(&self, provider_id: &str, name: &str) -> Result<(), ProviderError> {
        let mut lock = self.providers.lock().unwrap();
        let p = lock
            .get_mut(provider_id)
            .ok_or_else(|| ProviderError::NotFound(provider_id.to_string()))?;
        p.cfg_mut().name = name.to_string();
        Ok(())
    }

    /// 更新供应商模型列表（内存）。
    pub fn update_models(&self, provider_id: &str, models: Vec<ModelDef>) -> Result<(), ProviderError> {
        let mut lock = self.providers.lock().unwrap();
        let p = lock
            .get_mut(provider_id)
            .ok_or_else(|| ProviderError::NotFound(provider_id.to_string()))?;
        p.cfg_mut().models = models;
        Ok(())
    }

    /// 移除一个供应商。
    /// Look up a model definition by provider + model ID without requiring an API key.
    pub fn get_model(&self, provider_id: &str, model_id: &str) -> Option<ModelDef> {
        let lock = self.providers.lock().unwrap();
        lock.get(provider_id)?
            .cfg()
            .models
            .iter()
            .find(|m| m.id == model_id)
            .cloned()
    }

    pub fn remove(&self, provider_id: &str) -> Result<(), ProviderError> {
        self.providers.lock().unwrap().remove(provider_id)
            .map(|_| ())
            .ok_or_else(|| ProviderError::NotFound(provider_id.to_string()))
    }

    pub fn list(&self) -> Vec<ProviderConfig> {
        self.providers
            .lock()
            .unwrap()
            .values()
            .map(|p| p.cfg().clone())
            .collect()
    }

    fn resolve(
        &self,
        provider_id: &str,
        model_id: &str,
    ) -> Result<(ProviderConfig, ModelDef, String), ProviderError> {
        let lock = self.providers.lock().unwrap();
        let provider = lock.get(provider_id)
            .ok_or_else(|| ProviderError::NotFound(provider_id.to_string()))?;
        let cfg = provider.cfg().clone();
        let model = cfg
            .models
            .iter()
            .find(|m| m.id == model_id)
            .cloned()
            .ok_or_else(|| ProviderError::ModelNotFound {
                provider: provider_id.to_string(),
                model: model_id.to_string(),
            })?;
        let api_key = provider
            .api_key()
            .ok_or_else(|| ProviderError::MissingApiKey(provider_id.to_string()))?;
        Ok((cfg, model, api_key))
    }

    /// 主入口：按家族分发；流式事件通过 `sink` 推回。
    /// 调用方（commands.rs）负责把事件转 Tauri event 推到前端。
    pub async fn stream(
        &self,
        req: &GenerateRequest,
        sink: &UnboundedSender<AssistantMessageEvent>,
    ) -> Result<crate::ai::event::PartialMessage, ProviderError> {
        let (cfg, model, api_key) = self.resolve(&req.provider_id, &req.model_id)?;
        match cfg.api {
            ApiFamily::OpenAICompletions => {
                crate::ai::providers::openai_completions::stream(
                    &cfg, &model, &req.context, &req.settings, &api_key, sink,
                )
                .await
            }
            ApiFamily::AnthropicMessages => {
                crate::ai::providers::anthropic_messages::stream(
                    &cfg, &model, &req.context, &req.settings, &api_key, sink,
                )
                .await
            }
            ApiFamily::GoogleGenerativeAi => {
                crate::ai::providers::google_generative_ai::stream(
                    &cfg, &model, &req.context, &req.settings, &api_key, sink,
                )
                .await
            }
        }
    }

    /// 注入内置供应商（OpenAI / Anthropic / Gemini / OpenRouter / Ollama / Kobold）
    pub fn seed_builtin(&self) {
        for spec in builtin_specs() {
            let key = crate::ai::keychain::get(&spec.id).unwrap_or(None);
            self.register(spec, key);
        }
    }
}


/// 内置供应商清单。
fn builtin_specs() -> Vec<ProviderConfig> {
    use crate::ai::model::{CompatFlags, ModelDef};

    fn model(id: &str, name: &str, ctx: u64, max: u64, reasoning: bool) -> ModelDef {
        ModelDef {
            id: id.into(),
            name: name.into(),
            api: None,
            reasoning,
            thinking_level_map: Default::default(),
            context_window: ctx,
            max_tokens: max,
        }
    }

    vec![
        ProviderConfig {
            id: "openai".into(),
            name: "OpenAI".into(),
            base_url: "https://api.openai.com/v1".into(),
            api: ApiFamily::OpenAICompletions,
            models: vec![],
            compat: CompatFlags {
                supports_developer_role: true,
                supports_reasoning_effort: true,
                max_tokens_field: Some(MaxTokensField::MaxCompletionTokens),
                ..Default::default()
            },
            auth_header: true,
        },
        ProviderConfig {
            id: "anthropic".into(),
            name: "Anthropic (Claude)".into(),
            base_url: "https://api.anthropic.com/v1".into(),
            api: ApiFamily::AnthropicMessages,
            models: vec![],
            compat: CompatFlags::default(),
            auth_header: true,
        },
        ProviderConfig {
            id: "google".into(),
            name: "Google (Gemini)".into(),
            base_url: "https://generativelanguage.googleapis.com/v1beta".into(),
            api: ApiFamily::GoogleGenerativeAi,
            models: vec![],
            compat: CompatFlags::default(),
            auth_header: true,
        },
        ProviderConfig {
            id: "openrouter".into(),
            name: "OpenRouter".into(),
            base_url: "https://openrouter.ai/api/v1".into(),
            api: ApiFamily::OpenAICompletions,
            models: vec![],
            compat: CompatFlags {
                supports_developer_role: true,
                ..Default::default()
            },
            auth_header: true,
        },
    ]
}