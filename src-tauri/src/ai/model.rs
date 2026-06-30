//! Provider / Model / Context / 采样参数等数据模型。
//! 与 `DESIGN.md`「三、数据模型」对齐，并扩展 ST 私有字段。
//! 这些类型由前端通过 IPC 下发，故都派生 `serde::Serialize + Deserialize`。

use serde::{Deserialize, Serialize};

/// 角色：用户 / 助手 / 系统。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    #[default]
    User,
    Assistant,
    System,
}

/// ST 风格的历史消息（含 swipes / 思维链 / 工具调用 / 附件）。
/// 由前端持久化管理，生成时打包成 `CharacterMessage` 下发。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CharacterMessage {
    /// 消息唯一 ID（前端生成）
    #[serde(default)]
    pub id: Option<String>,
    pub role: Role,
    pub content: String,
    #[serde(default)]
    pub swipes: Vec<String>,
    #[serde(default)]
    pub current_swipe_index: usize,
    /// CoT 推理内容（tools 思维链折叠）
    #[serde(default)]
    pub reasoning: Option<String>,
    /// 消息时间戳（毫秒）
    #[serde(default)]
    pub timestamp: Option<u64>,
}

/// API 家族：决定走哪个 streamSimple 实现。
/// 多数供应商一个 `OpenAICompletions` 一把梭。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ApiFamily {
    /// OpenAI Chat Completions（通吃 OpenAI/OpenRouter/Ollama/Kobold/vLLM/Together/Groq/DeepSeek…）
    #[serde(rename = "openai-completions")]
    OpenAICompletions,
    /// Anthropic Messages（Claude 及走 Claude 协议的代理）
    AnthropicMessages,
    /// Google Generative AI（Gemini）
    GoogleGenerativeAi,
}

impl ApiFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            ApiFamily::OpenAICompletions => "openai-completions",
            ApiFamily::AnthropicMessages => "anthropic-messages",
            ApiFamily::GoogleGenerativeAi => "google-generative-ai",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "openai-completions" | "openai" => ApiFamily::OpenAICompletions,
            "anthropic-messages" | "anthropic" => ApiFamily::AnthropicMessages,
            "google-generative-ai" | "google" | "gemini" => ApiFamily::GoogleGenerativeAi,
            _ => return None,
        })
    }
}

/// Provider 兼容小差异开关（不写新 provider，仅改请求体形状）。
/// 对照 `DESIGN.md` compat 开关表。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CompatFlags {
    /// true -> `developer` 角色可用；false -> 退回 `system`
    #[serde(default = "compat_default_supports_developer_role")]
    pub supports_developer_role: bool,

    /// 是否发送 `reasoning_effort`
    #[serde(default)]
    pub supports_reasoning_effort: bool,

    /// 是否发 `stream_options: { include_usage: true }`
    #[serde(default = "compat_default_supports_usage_in_streaming")]
    pub supports_usage_in_streaming: bool,

    /// `max_tokens` vs `max_completion_tokens`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens_field: Option<MaxTokensField>,

    /// tool 结果是否要求 `name` 字段
    #[serde(default)]
    pub requires_tool_result_name: bool,

    /// tool 结果后是否需要插一条 assistant 消息
    #[serde(default)]
    pub requires_assistant_after_tool_result: bool,

    /// thinking 字段形状：`openai` | `openrouter` | `deepseek` | `together` | `qwen`…
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_format: Option<String>,

    /// Anthropic 风格 cache_control 标记
    #[serde(default)]
    pub cache_control_format: Option<String>,
}

fn compat_default_supports_developer_role() -> bool {
    false
}
fn compat_default_supports_usage_in_streaming() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MaxTokensField {
    MaxTokens,
    MaxCompletionTokens,
}

/// 单个模型定义（用于 `/models` 检索与 UI 显示）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDef {
    pub id: String,
    pub name: String,
    pub api: Option<ApiFamily>,
    pub reasoning: bool,
    /// 统一 thinking 等级随 provider 的 thinkingLevelMap 映射（Phase 1 暂不启用）
    #[serde(default)]
    pub thinking_level_map: std::collections::HashMap<String, Option<String>>,
    pub context_window: u64,
    pub max_tokens: u64,
}

impl ModelDef {
    pub fn api_or(&self, fallback: ApiFamily) -> ApiFamily {
        self.api.unwrap_or(fallback)
    }
}

/// 已注册的供应商配置。
/// `api_key` 仅在内存；密钥本体存 OS keychain，见 `keychain.rs`。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api: ApiFamily,
    pub models: Vec<ModelDef>,
    #[serde(default)]
    pub compat: CompatFlags,
    /// true 时附带 `Authorization: Bearer <key>`
    #[serde(default = "compat_default_auth_header")]
    pub auth_header: bool,
}

fn compat_default_auth_header() -> bool {
    true
}

/// 工具调用（Phase 2 落地，Phase 1 仅在模型上留口）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub name: Option<String>,
    pub content: String,
}

/// 一轮请求的上下文。前端简化历史成 `Role + 文本` 下发。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GenerateContext {
    pub system: Option<String>,
    pub messages: Vec<CharacterMessage>,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
    #[serde(default)]
    pub tool_results: Vec<ToolResult>,
}

/// ST 风格采样参数。各字段按 provider 形状选择性映射。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GenerateSettings {
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub top_k: Option<u32>,
    pub min_p: Option<f64>,
    pub typical_p: Option<f64>,
    pub repetition_penalty: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
    pub mirostat_mode: Option<u32>,
    pub mirostat_tau: Option<f32>,
    pub mirostat_eta: Option<f32>,
    pub max_tokens: Option<u64>,
    pub context_length: Option<u64>,
    pub stop_sequences: Option<Vec<String>>,
    pub seed: Option<i64>,
}

/// 统一 thinking 等级（Phase 1 不强求 provider 支持，仅透传）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThinkingLevel {
    Off,
    Minimal,
    Low,
    Medium,
    High,
    XHigh,
}

/// 前端通过 IPC 发起的生成请求。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateRequest {
    pub provider_id: String,
    pub model_id: String,
    pub context: GenerateContext,
    pub settings: GenerateSettings,
    /// 当前聊天的角色 ID，用于加载角色数据与关联的世界书
    #[serde(default)]
    pub character_id: Option<String>,
}