//! Anthropic Messages API (Claude) 流式实现。
//!
//! 与 OpenAI 家族的差异：
//! - `system` 是顶层独立字段，不是 messages 数组里的一条
//! - 认证用 `x-api-key` 头 + `anthropic-version` 头
//! - 流式事件块分 `message_start` / `content_block_start` / `content_block_delta` /
//!   `content_block_stop` / `message_delta` / `message_stop`，需各自映射到
//!   统一 `AssistantMessageEvent`
//! - thinking 块走 `thinking_delta`（`thinking` content block）
//!
//! 流式协议: https://docs.anthropic.com/en/api/messages-streaming

use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde_json::Value;
use futures_util::StreamExt;
use tokio::sync::mpsc::UnboundedSender;

use crate::ai::error::ProviderError;
use crate::ai::event::{AssistantMessageEvent, PartialMessage};
use crate::ai::model::{
    GenerateContext, GenerateSettings, ModelDef, ProviderConfig, Role,
};
use crate::ai::sse::iter_lines;

const ANTHROPIC_VERSION: &str = "2023-06-01";

pub async fn stream(
    cfg: &ProviderConfig,
    model: &ModelDef,
    ctx: &GenerateContext,
    settings: &GenerateSettings,
    api_key: &str,
    sink: &UnboundedSender<AssistantMessageEvent>,
) -> Result<PartialMessage, ProviderError> {
    // 1) 组装请求体
    let mut body = serde_json::Map::new();
    body.insert("model".into(), Value::String(model.id.clone()));
    body.insert("stream".into(), Value::Bool(true));
    body.insert(
        "max_tokens".into(),
        Value::Number(
            settings
                .max_tokens
                .unwrap_or(model.max_tokens.min(4096))
                .into(),
        ),
    );

    // system 作为顶层字段
    if let Some(sys) = &ctx.system {
        let sys = sys.trim();
        if !sys.is_empty() {
            // Anthropic 支持 system 为 string 或 content block 数组；这里用简单 string
            body.insert("system".into(), Value::String(sys.to_string()));
        }
    }

    // messages 数组
    let messages = build_messages(ctx);
    body.insert("messages".into(), Value::Array(messages));

    // 采样参数
    if let Some(t) = settings.temperature {
        body.insert("temperature".into(), Value::Number(serde_json::Number::from_f64(t).unwrap()));
    }
    if let Some(p) = settings.top_p {
        body.insert("top_p".into(), Value::Number(serde_json::Number::from_f64(p).unwrap()));
    }
    if let Some(k) = settings.top_k {
        body.insert("top_k".into(), Value::Number(k.into()));
    }
    if let Some(stops) = &settings.stop_sequences {
        if !stops.is_empty() {
            body.insert("stop_sequences".into(), Value::Array(
                stops.iter().map(|s| Value::String(s.clone())).collect(),
            ));
        }
    }

    // thinking 配置 (Claude Sonnet 4 / Opus 4)
    if model.reasoning {
        // 启用 extended thinking；budget 默认 1024
        body.insert(
            "thinking".into(),
            serde_json::json!({
                "type": "enabled",
                "budget_tokens": 1024
            }),
        );
    }

    let body = Value::Object(body);

    // 2) 组装请求头
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key)
            .map_err(|e| ProviderError::Upstream(e.to_string()))?,
    );
    headers.insert(
        "anthropic-version",
        HeaderValue::from_static(ANTHROPIC_VERSION),
    );

    // 3) 发起请求
    let base = cfg.base_url.trim_end_matches('/');
    let url = format!("{}/messages", base);
    let client = reqwest::Client::builder().build()?;
    let resp = client.post(&url).headers(headers).json(&body).send().await?;

    let status = resp.status();
    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        return Err(ProviderError::HttpStatus {
            status: status.as_u16(),
            body: body_text,
        });
    }

    // 4) 解析 SSE 流
    let mut partial = PartialMessage::default();
    let _ = sink.send(AssistantMessageEvent::Start {
        partial: partial.clone(),
    });

    // 跟踪当前 content block 类型：text / thinking / tool_use
    #[derive(PartialEq)]
    enum BlockType {
        Text,
        Thinking,
        Unknown,
    }
    let mut current_block: BlockType = BlockType::Unknown;
    let mut current_block_index: usize = 0;
    let mut text = String::new();
    let mut thinking = String::new();
    let mut text_started = false;
    let mut thinking_started = false;

    let mut current_event = String::new();
    let stream = iter_lines(resp);
    tokio::pin!(stream);
    while let Some(line_res) = stream.next().await {
        let line = line_res?;

        // Anthropic SSE 行格式：
        // event: message_start
        // data: {...}
        if let Some(ev) = line.strip_prefix("event: ") {
            current_event = ev.trim().to_string();
            continue;
        }

        let data = match line.strip_prefix("data:").map(str::trim) {
            Some(d) if !d.is_empty() => d,
            _ => continue,
        };

        let v: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let event_type = current_event.as_str();
        match event_type {
            "message_start" => {
                // 提取 usage
                if let Some(usage) = v.pointer("/message/usage") {
                    partial.input_tokens = usage
                        .get("input_tokens")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    partial.output_tokens = usage
                        .get("output_tokens")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                }
            }

            "content_block_start" => {
                let block = &v["content_block"];
                let block_type = block["type"].as_str().unwrap_or("");
                current_block = match block_type {
                    "text" => BlockType::Text,
                    "thinking" => BlockType::Thinking,
                    _ => BlockType::Unknown,
                };

                match current_block {
                    BlockType::Text => {
                        if !text_started {
                            text_started = true;
                            current_block_index = 0;
                            let _ = sink.send(AssistantMessageEvent::TextStart {
                                content_index: current_block_index,
                                partial: partial.clone(),
                            });
                        }
                    }
                    BlockType::Thinking => {
                        if !thinking_started {
                            thinking_started = true;
                            let _ = sink.send(AssistantMessageEvent::ThinkingStart {
                                content_index: 0,
                                partial: partial.clone(),
                            });
                        }
                    }
                    _ => {}
                }
            }

            "content_block_delta" => {
                let delta = &v["delta"];
                let delta_type = delta["type"].as_str().unwrap_or("");
                match delta_type {
                    "text_delta" => {
                        if let Some(t) = delta["text"].as_str() {
                            text.push_str(t);
                            partial.text = text.clone();
                            let _ = sink.send(AssistantMessageEvent::TextDelta {
                                content_index: current_block_index,
                                delta: t.to_string(),
                                partial: partial.clone(),
                            });
                        }
                    }
                    "thinking_delta" => {
                        if let Some(t) = delta["thinking"].as_str() {
                            thinking.push_str(t);
                            partial.thinking = thinking.clone();
                            let _ = sink.send(AssistantMessageEvent::ThinkingDelta {
                                content_index: 0,
                                delta: t.to_string(),
                                partial: partial.clone(),
                            });
                        }
                    }
                    "signature_delta" => {
                        // Claude thinking 签名，不需要推给前端
                    }
                    _ => {}
                }
            }

            "content_block_stop" => {
                match current_block {
                    BlockType::Text => {
                        let _ = sink.send(AssistantMessageEvent::TextEnd {
                            content_index: current_block_index,
                            content: text.clone(),
                            partial: partial.clone(),
                        });
                        current_block_index += 1;
                    }
                    BlockType::Thinking => {
                        let _ = sink.send(AssistantMessageEvent::ThinkingEnd {
                            content_index: 0,
                            content: thinking.clone(),
                            partial: partial.clone(),
                        });
                    }
                    _ => {}
                }
                current_block = BlockType::Unknown;
            }

            "message_delta" => {
                // usage 更新
                if let Some(usage) = v.pointer("/usage") {
                    partial.output_tokens = usage
                        .get("output_tokens")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(partial.output_tokens);
                }
                // stop_reason
                if let Some(stop_reason) = v.pointer("/delta/stop_reason").and_then(|x| x.as_str()) {
                    partial.text = text.clone();
                    partial.thinking = thinking.clone();
                    let _ = sink.send(AssistantMessageEvent::Done {
                        reason: stop_reason.to_string(),
                        partial: partial.clone(),
                    });
                    return Ok(partial);
                }
            }

            "message_stop" => {
                // 部分代理可能不 emit message_delta 的 stop_reason，在此收尾
                // 能走到这里说明 message_delta 没有 return
                partial.text = text.clone();
                partial.thinking = thinking.clone();
                let _ = sink.send(AssistantMessageEvent::Done {
                    reason: "end_turn".to_string(),
                    partial: partial.clone(),
                });
                return Ok(partial);
            }

            "error" => {
                let msg = v["error"]["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string();
                let _ = sink.send(AssistantMessageEvent::Error {
                    reason: "upstream".to_string(),
                    message: msg.clone(),
                });
                return Err(ProviderError::Upstream(msg));
            }

            _ => {}
        }
    }

    // 正常结束但可能没有 message_delta
    partial.text = text.clone();
    partial.thinking = thinking.clone();
    let _ = sink.send(AssistantMessageEvent::Done {
        reason: "end_turn".to_string(),
        partial: partial.clone(),
    });
    Ok(partial)
}

/// 构建 Anthropic messages 数组。
/// Anthropic 要求 user / assistant 交替，且不能以 assistant 开头。
fn build_messages(ctx: &GenerateContext) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();

    for m in &ctx.messages {
        let content = if !m.content.trim().is_empty() {
            m.content.clone()
        } else if !m.swipes.is_empty() {
            m.swipes
                .get(m.current_swipe_index)
                .cloned()
                .unwrap_or_default()
        } else {
            continue;
        };

        let role = match m.role {
            Role::User => "user",
            Role::Assistant => "assistant",
            // Anthropic 不支持 system role 在 messages 里；system 已走顶层字段
            Role::System => continue,
        };

        // 确保不连续出现相同 role
        if let Some(last) = out.last() {
            if last["role"].as_str() == Some(role) {
                // 合并内容或插入占位
                continue;
            }
        }

        // Anthropic 要求第一条消息必须是 user
        if out.is_empty() && role == "assistant" {
            // 插入一条空 user 消息占位
            out.push(serde_json::json!({
                "role": "user",
                "content": [{"type": "text", "text": "."}]
            }));
        }

        out.push(serde_json::json!({
            "role": role,
            "content": [{"type": "text", "text": content}]
        }));
    }

    // 如果最后一条是 assistant，末尾需是 user（实际由 GenerateContext 保证）
    out
}
