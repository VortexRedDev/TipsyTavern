//! LLM Provider 抽象层。
//!
//! 设计参见 `DESIGN.md`「五、技术方案 / LLM Provider 架构」：
//! 少数 API 家族 × 一套 compat 开关，收敛数十家供应商。
//! 流式 token 经 Tauri event 推回前端，前端不直接调供应商接口。

// Phase 1 暴露给后续阶段（CoT / 工具调用 / 摘要 / RAG 等）的 API 面尚未接通by 逻辑，
// 在过渡期允许存在“暂时未被调用的公共项”。
#![allow(dead_code)]

pub mod context;
pub mod error;
pub mod event;
pub mod keychain;
pub mod model;
pub mod provider;
pub mod providers;
pub mod sse;
pub mod worldbook;

#[allow(unused_imports)]
pub use error::ProviderError;
#[allow(unused_imports)]
pub use event::AssistantMessageEvent;
#[allow(unused_imports)]
pub use model::{
    ApiFamily, CharacterMessage, CompatFlags, GenerateContext, GenerateRequest, GenerateSettings,
    ModelDef, ProviderConfig, Role, ToolCall, ToolResult,
};
#[allow(unused_imports)]
pub use provider::{LlmProvider, ProviderRegistry};
#[allow(unused_imports)]
pub use worldbook::{WorldBookSettings, ActivatedWorldInfo};