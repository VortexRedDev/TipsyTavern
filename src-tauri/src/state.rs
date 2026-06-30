//! Tauri 全局状态。持 Provider 注册表、存储、后续生成管线等跨命令共享状态。

use std::path::PathBuf;
use std::sync::Arc;
use crate::ai::ProviderRegistry;
use crate::ai::model::{ApiFamily, ProviderConfig};
use crate::storage::Storage;

pub struct AppState {
    pub registry: Arc<ProviderRegistry>,
    pub storage: Arc<Storage>,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let registry = ProviderRegistry::new();
        registry.seed_builtin();
        let storage = Storage::new(app_data_dir);
        Self {
            registry: Arc::new(registry),
            storage: Arc::new(storage),
        }
    }

    /// 从 settings.json 恢复 provider 配置（base_url、name、models、自定义 provider）。
    pub async fn restore_provider_configs(&self) {
        if let Ok(settings) = self.storage.load_settings().await {
            if let Some(providers) = settings.get("providers").and_then(|v| v.as_array()) {
                for p in providers {
                    let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let name = p.get("name").and_then(|v| v.as_str()).unwrap_or(id);
                    let base_url = p.get("base_url").and_then(|v| v.as_str()).unwrap_or("");

                    // If this provider isn't in the registry (custom), register it
                    if self.registry.list().iter().all(|cfg| cfg.id != id) {
                        // Load API key from keychain if present
                        let key = crate::ai::keychain::get(id).unwrap_or(None);
                        self.registry.register(ProviderConfig {
                            id: id.to_string(),
                            name: name.to_string(),
                            base_url: base_url.to_string(),
                            api: ApiFamily::OpenAICompletions,
                            models: vec![],
                            compat: Default::default(),
                            auth_header: true,
                        }, key);
                    }

                    if !base_url.is_empty() {
                        let _ = self.registry.update_base_url(id, base_url);
                    }
                    if let Some(models) = p.get("models").and_then(|v| v.as_array()) {
                        let model_defs: Vec<crate::ai::ModelDef> = models
                            .iter()
                            .filter_map(|m| {
                                Some(crate::ai::ModelDef {
                                    id: m.get("id")?.as_str()?.to_string(),
                                    name: m.get("name")?.as_str()?.to_string(),
                                    api: None,
                                    reasoning: m.get("reasoning").and_then(|v| v.as_bool()).unwrap_or(false),
                                    thinking_level_map: Default::default(),
                                    context_window: m.get("context_window").and_then(|v| v.as_u64()).unwrap_or(128000),
                                    max_tokens: m.get("max_tokens").and_then(|v| v.as_u64()).unwrap_or(16384),
                                })
                            })
                            .collect();
                        let _ = self.registry.update_models(id, model_defs);
                    }
                }
            }
        }
    }
}