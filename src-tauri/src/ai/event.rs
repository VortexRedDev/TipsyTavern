//! 统一的 `AssistantMessageEvent` —— 与具体 provider 解耦的事件协议。
//!
//! 流式回包被分解成这一组事件推到前端；前端只订阅渲染，
//! 不需要知道当前是 OpenAI / Anthropic / Gemini。
//! 事件顺序：`Start` → 若干 `Text*` / `Thinking*` / `ToolCall*` → `Done` | `Error`。
//! `Inspector` 事件在流开始前推送，携带本次请求的完整上下文信息。

use serde::{Deserialize, Serialize};

use super::model::CharacterMessage;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AssistantMessageEvent {
    /// 上下文快照：在流式开始前推送，方便 Inspector 面板查看完整请求
    Inspector {
        system_prompt: String,
        messages: Vec<CharacterMessage>,
        model_id: String,
        provider_id: String,
        character_name: Option<String>,
        world_info_activated: usize,
        world_info_tokens_used: usize,
        timestamp: u64,
    },
    /// 流式开始。`partial` 是当前累积的 assistant 消息骨架
    Start { partial: PartialMessage },
    /// 文本块开始
    TextStart { content_index: usize, partial: PartialMessage },
    /// 文本增量
    TextDelta {
        content_index: usize,
        delta: String,
        partial: PartialMessage,
    },
    /// 文本块结束
    TextEnd {
        content_index: usize,
        content: String,
        partial: PartialMessage,
    },
    /// 思维链开始
    ThinkingStart { content_index: usize, partial: PartialMessage },
    /// 思维链增量
    ThinkingDelta {
        content_index: usize,
        delta: String,
        partial: PartialMessage,
    },
    /// 思维链结束
    ThinkingEnd {
        content_index: usize,
        content: String,
        partial: PartialMessage,
    },
    /// 一次完整流结束。reason: stop | length | tool_use | cancelled
    Done { reason: String, partial: PartialMessage },
    /// 流式失败
    Error { reason: String, message: String },
}

/// 当前累积的 assistant 消息快照，随每个事件一起回传，便于前端增量渲染。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PartialMessage {
    /// 已完成文本
    pub text: String,
    /// 已完成思维链
    pub thinking: String,
    /// 累积 usage（部分 provider 会在 done 前回灌）
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}