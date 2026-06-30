//! 各 API 家族的 streamSimple 实现。
//! 每个家族一个文件；签名一致：
//!
//! ```ignore
//! pub async fn stream(
//!     cfg: &ProviderConfig,
//!     model: &ModelDef,
//!     ctx: &GenerateContext,
//!     settings: &GenerateSettings,
//!     api_key: &str,
//!     sink: &UnboundedSender<AssistantMessageEvent>,
//! ) -> ProviderResult<PartialMessage>
//! ```

pub mod anthropic_messages;
pub mod google_generative_ai;
pub mod openai_completions;