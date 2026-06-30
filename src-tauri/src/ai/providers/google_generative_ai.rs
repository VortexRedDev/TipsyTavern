//! Google Generative AI (Gemini) 流式实现。
//!
//! 与 OpenAI 家族的差异：
//! - 路径 `:streamGenerateContent?alt=sse&key=<API_KEY>`，key 在 query 不在 Authorization
//! - 消息体是 `contents: [{ role, parts: [{ text }] }]` 结构
//! - `systemInstruction` 顶层字段
//! - Gemini Flash Thinking 走 `thought` / `thoughtSignature` 字段
//! - `safetySettings` 单独字段
//! - `generationConfig` 包含采样参数
//!
//! 流式协议: https://ai.google.dev/api/generate-content#streamGenerateContent

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

    // contents 数组
    let contents = build_contents(ctx);
    body.insert("contents".into(), Value::Array(contents));

    // systemInstruction
    if let Some(sys) = &ctx.system {
        let sys = sys.trim();
        if !sys.is_empty() {
            body.insert(
                "systemInstruction".into(),
                serde_json::json!({
                    "parts": [{"text": sys}]
                }),
            );
        }
    }

    // generationConfig
    let mut gen_config = serde_json::Map::new();
    if let Some(t) = settings.temperature {
        gen_config.insert("temperature".into(), Value::Number(serde_json::Number::from_f64(t).unwrap()));
    }
    if let Some(p) = settings.top_p {
        gen_config.insert("topP".into(), Value::Number(serde_json::Number::from_f64(p).unwrap()));
    }
    if let Some(k) = settings.top_k {
        gen_config.insert("topK".into(), Value::Number(k.into()));
    }
    if let Some(max) = settings.max_tokens {
        gen_config.insert("maxOutputTokens".into(), Value::Number(max.into()));
    }
    if let Some(stops) = &settings.stop_sequences {
        if !stops.is_empty() {
            gen_config.insert("stopSequences".into(), Value::Array(
                stops.iter().map(|s| Value::String(s.clone())).collect(),
            ));
        }
    }

    // thinking 配置 (Gemini Flash Thinking)
    if model.reasoning {
        // 启用 thinking；对于 Flash Thinking 模型，默认就会返回 thought
        gen_config.insert(
            "thinkingConfig".into(),
            serde_json::json!({
                "includeThoughts": true
            }),
        );
    }

    if !gen_config.is_empty() {
        body.insert("generationConfig".into(), Value::Object(gen_config));
    }

    let body = Value::Object(body);

    // 2) 组装请求头
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    // 3) 发起请求 (API key 在 query parameter 中)
    let base = cfg.base_url.trim_end_matches('/');
    let url = format!(
        "{}/models/{}:streamGenerateContent?alt=sse&key={}",
        base, model.id, api_key
    );
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

    let mut text = String::new();
    let mut thinking = String::new();
    let mut text_started = false;
    let mut thinking_started = false;
    let content_index: usize = 0;

    let stream = iter_lines(resp);
    tokio::pin!(stream);
    while let Some(line_res) = stream.next().await {
        let line = line_res?;
        let data = match line.strip_prefix("data:").map(str::trim) {
            Some(d) if !d.is_empty() => d,
            _ => continue,
        };

        let v: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Gemini SSE 事件结构：
        // {
        //   "candidates": [{
        //     "content": { "role": "model", "parts": [{"text": "..."}, {"thought": "..."}] },
        //     "finishReason": "STOP",
        //     ...
        //   }],
        //   "usageMetadata": { ... }
        // }

        let candidate = match v.pointer("/candidates/0") {
            Some(c) => c,
            None => {
                // 可能是纯 usage 帧或错误
                if let Some(usage) = v.get("usageMetadata") {
                    partial.input_tokens = usage
                        .get("promptTokenCount")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(partial.input_tokens);
                    partial.output_tokens = usage
                        .get("candidatesTokenCount")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(partial.output_tokens);
                }
                continue;
            }
        };

        // 提取 parts（Gemini SSE 是累积的，不是增量；需计算 delta）
        if let Some(parts) = candidate.pointer("/content/parts").and_then(|x| x.as_array()) {
            // 累积的完整文本
            let mut new_text = String::new();
            let mut new_thinking = String::new();
            for part in parts {
                if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                    new_text.push_str(t);
                }
                if let Some(t) = part.get("thought").and_then(|x| x.as_str()) {
                    if !t.trim().is_empty() {
                        new_thinking.push_str(t);
                    }
                }
            }

            // 计算文本增量
            if new_text.len() > text.len() {
                let delta = new_text[text.len()..].to_string();
                if !text_started {
                    text_started = true;
                    let _ = sink.send(AssistantMessageEvent::TextStart {
                        content_index,
                        partial: partial.clone(),
                    });
                }
                text = new_text;
                partial.text = text.clone();
                let _ = sink.send(AssistantMessageEvent::TextDelta {
                    content_index,
                    delta,
                    partial: partial.clone(),
                });
            }

            // 计算思维链增量
            if new_thinking.len() > thinking.len() {
                let delta = new_thinking[thinking.len()..].to_string();
                if !thinking_started {
                    thinking_started = true;
                    let _ = sink.send(AssistantMessageEvent::ThinkingStart {
                        content_index: 0,
                        partial: partial.clone(),
                    });
                }
                thinking = new_thinking;
                partial.thinking = thinking.clone();
                let _ = sink.send(AssistantMessageEvent::ThinkingDelta {
                    content_index: 0,
                    delta,
                    partial: partial.clone(),
                });
            }
        }

        // 检查是否结束
        if let Some(reason) = candidate.get("finishReason").and_then(|x| x.as_str()) {
            if reason != "STOP" && !reason.is_empty() {
                // 非正常结束原因
                if thinking_started {
                    let _ = sink.send(AssistantMessageEvent::ThinkingEnd {
                        content_index: 0,
                        content: thinking.clone(),
                        partial: partial.clone(),
                    });
                }
                if text_started {
                    let _ = sink.send(AssistantMessageEvent::TextEnd {
                        content_index,
                        content: text.clone(),
                        partial: partial.clone(),
                    });
                }
                partial.text = text.clone();
                partial.thinking = thinking.clone();
                let done_reason = match reason {
                    "MAX_TOKENS" => "length",
                    "SAFETY" => "content_filter",
                    "RECITATION" => "content_filter",
                    _ => reason,
                };
                let _ = sink.send(AssistantMessageEvent::Done {
                    reason: done_reason.to_string(),
                    partial: partial.clone(),
                });
                return Ok(partial);
            }
        }
    }

    // 正常收尾
    if thinking_started {
        let _ = sink.send(AssistantMessageEvent::ThinkingEnd {
            content_index: 0,
            content: thinking.clone(),
            partial: partial.clone(),
        });
    }
    if text_started {
        let _ = sink.send(AssistantMessageEvent::TextEnd {
            content_index,
            content: text.clone(),
            partial: partial.clone(),
        });
    }
    partial.text = text.clone();
    partial.thinking = thinking.clone();
    let _ = sink.send(AssistantMessageEvent::Done {
        reason: "stop".to_string(),
        partial: partial.clone(),
    });
    Ok(partial)
}

/// 构建 Gemini contents 数组。
/// Gemini 使用 "user" / "model" 角色（不是 "assistant"）。
fn build_contents(ctx: &GenerateContext) -> Vec<Value> {
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
            Role::Assistant => "model",
            // Gemini 不支持 system role 在 contents 里
            Role::System => continue,
        };

        // 合并连续相同 role 的内容
        if let Some(last) = out.last_mut() {
            if last["role"].as_str() == Some(role) {
                if let Some(parts) = last.get_mut("parts").and_then(|x| x.as_array_mut()) {
                    parts.push(serde_json::json!({"text": content}));
                }
                continue;
            }
        }

        out.push(serde_json::json!({
            "role": role,
            "parts": [{"text": content}]
        }));
    }

    out
}
