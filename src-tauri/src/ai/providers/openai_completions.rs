//! OpenAI Chat Completions 流式实现（通吃 OpenAI/OpenRouter/Ollama/Kobold/vLLM…）
//!
//! 通过 `compat` 开关切换请求体形状：
//! - `supports_developer_role`：system 消息用 `developer` 还是 `system`
//! - `supports_usage_in_streaming`：是否发 `stream_options: { include_usage: true }`
//! - `max_tokens_field`：`max_tokens` vs `max_completion_tokens`
//! - `auth_header`：是否附带 `Authorization: Bearer <key>`
//!
//! 输出统一 `AssistantMessageEvent`，前端无需知道底细。

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde_json::json;
use futures_util::StreamExt;
use tokio::sync::mpsc::UnboundedSender;

use crate::ai::error::ProviderError;
use crate::ai::event::{AssistantMessageEvent, PartialMessage};
use crate::ai::model::{
    CharacterMessage, GenerateContext, GenerateSettings, MaxTokensField, ModelDef,
    ProviderConfig, Role,
};
use crate::ai::sse::iter_lines;

pub async fn stream(
    cfg: &ProviderConfig,
    model: &ModelDef,
    ctx: &GenerateContext,
    settings: &GenerateSettings,
    api_key: &str,
    sink: &UnboundedSender<AssistantMessageEvent>,
) -> Result<PartialMessage, ProviderError> {
    // 1) 组装 messages
    let messages = build_messages(cfg, ctx);

    // 2) 组装请求体
    let mut body = json!({
        "model": model.id,
        "messages": messages,
        "stream": true,
    });
    if let Some(t) = settings.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(p) = settings.top_p {
        body["top_p"] = json!(p);
    }
    if let Some(f) = settings.frequency_penalty {
        body["frequency_penalty"] = json!(f);
    }
    if let Some(p) = settings.presence_penalty {
        body["presence_penalty"] = json!(p);
    }
    if let Some(k) = settings.top_k {
        body["top_k"] = json!(k);
    }
    if let Some(max) = settings.max_tokens {
        let key = match cfg
            .compat
            .max_tokens_field
            .unwrap_or(MaxTokensField::MaxTokens)
        {
            MaxTokensField::MaxTokens => "max_tokens",
            MaxTokensField::MaxCompletionTokens => "max_completion_tokens",
        };
        body[key] = json!(max);
    }
    if let Some(stops) = &settings.stop_sequences {
        if !stops.is_empty() {
            body["stop"] = json!(stops);
        }
    }
    if let Some(seed) = settings.seed {
        body["seed"] = json!(seed);
    }
    if cfg.compat.supports_usage_in_streaming {
        body["stream_options"] = json!({ "include_usage": true });
    }

    // 3) 组装请求头
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if cfg.auth_header && !api_key.is_empty() {
        let bearer = format!("Bearer {}", api_key);
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&bearer)
                .map_err(|e| ProviderError::Upstream(e.to_string()))?,
        );
    }

    // 4) 发起请求
    let base = cfg.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base);
    let client = reqwest::Client::builder().build()?;
    let resp = client.post(&url).headers(headers).json(&body).send().await?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ProviderError::HttpStatus {
            status: status.as_u16(),
            body,
        });
    }

    // 5) 推 Start / TextStart，再流式解析 SSE
    let mut partial = PartialMessage::default();
    let _ = sink.send(AssistantMessageEvent::Start {
        partial: partial.clone(),
    });
    let _ = sink.send(AssistantMessageEvent::TextStart {
        content_index: 0,
        partial: partial.clone(),
    });

    let mut text = String::new();
    let mut thinking = String::new();
    let mut thinking_started = false;
    let stream = iter_lines(resp);
    tokio::pin!(stream);
    while let Some(line_res) = stream.next().await {
        let line = line_res?;
        let data = match line.strip_prefix("data:").map(str::trim) {
            Some(d) => d,
            None => continue,
        };
        if data == "[DONE]" { break; }
        let v: serde_json::Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // 推理/思考内容 (DeepSeek R1, QwQ 等)
        if let Some(reasoning) = v.pointer("/choices/0/delta/reasoning_content").and_then(|x| x.as_str()) {
            if !reasoning.is_empty() {
                if !thinking_started {
                    thinking_started = true;
                    let _ = sink.send(AssistantMessageEvent::ThinkingStart {
                        content_index: 0,
                        partial: partial.clone(),
                    });
                }
                thinking.push_str(reasoning);
                partial.thinking = thinking.clone();
                let _ = sink.send(AssistantMessageEvent::ThinkingDelta {
                    content_index: 0,
                    delta: reasoning.to_string(),
                    partial: partial.clone(),
                });
            }
        }

        // 文本增量
        if let Some(content) = v.pointer("/choices/0/delta/content").and_then(|x| x.as_str()) {
            if !content.is_empty() {
                text.push_str(content);
                partial.text = text.clone();
                let _ = sink.send(AssistantMessageEvent::TextDelta {
                    content_index: 0,
                    delta: content.to_string(),
                    partial: partial.clone(),
                });
            }
        }

        // usage
        if let Some(usage) = v.get("usage") {
            partial.input_tokens = usage.get("prompt_tokens").and_then(|x| x.as_u64()).unwrap_or(partial.input_tokens);
            partial.output_tokens = usage.get("completion_tokens").and_then(|x| x.as_u64()).unwrap_or(partial.output_tokens);
        }
    }

    if thinking_started {
        partial.thinking = thinking.clone();
        let _ = sink.send(AssistantMessageEvent::ThinkingEnd { content_index: 0, content: thinking.clone(), partial: partial.clone() });
    }
    // 6) 收尾
    partial.text = text.clone();
    let _ = sink.send(AssistantMessageEvent::Done {
        reason: "stop".to_string(),
        partial: partial.clone(),
    });
    Ok(partial)
}

/// 把 ST 风格的 `GenerateContext` 拍平成 OpenAI `messages` 数组。
fn build_messages(cfg: &ProviderConfig, ctx: &GenerateContext) -> Vec<serde_json::Value> {
    let mut out: Vec<serde_json::Value> = Vec::new();

    if let Some(sys) = &ctx.system {
        if !sys.trim().is_empty() {
            let role = if cfg.compat.supports_developer_role {
                "developer"
            } else {
                "system"
            };
            out.push(json!({ "role": role, "content": sys }));
        }
    }

    for m in &ctx.messages {
        if !m.content.trim().is_empty() {
            push_message(&mut out, m);
        } else if !m.swipes.is_empty() {
            // 选当前 swipe 为内容
            if let Some(c) = m.swipes.get(m.current_swipe_index) {
                if !c.trim().is_empty() {
                    let mut cloned = m.clone();
                    cloned.content = c.clone();
                    push_message(&mut out, &cloned);
                }
            }
        }
    }

    out
}

fn push_message(out: &mut Vec<serde_json::Value>, m: &CharacterMessage) {
    let role = match m.role {
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::System => "system",
    };
    out.push(json!({ "role": role, "content": m.content }));
}