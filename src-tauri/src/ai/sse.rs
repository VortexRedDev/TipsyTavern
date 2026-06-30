//! 极简 SSE 行解析：把 `reqwest::Response::bytes_stream()` 切成逐行 String。
//! 仅用于读取 `data: ...` 形态的 chat-completions 流（OpenAI 及兼容家族）。
//! 不做完整 EventSource 协议实现，足够本阶段需要。

use async_stream::try_stream;
use bytes::Bytes;
use futures_util::stream::Stream;
use futures_util::StreamExt;

use crate::ai::error::ProviderError;

pub fn iter_lines(
    response: reqwest::Response,
) -> impl Stream<Item = Result<String, ProviderError>> {
    try_stream! {
        let mut stream = response.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        while let Some(chunk) = stream.next().await {
            // 把网络/IO 错误转成 ProviderError::Network
            let chunk: Bytes = chunk?;
            buf.extend_from_slice(&chunk);
            // 按 \n 切行；保留不完整末尾在 buf
            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                // 去掉行尾 \r\n
                let line = String::from_utf8_lossy(&line_bytes)
                    .trim_end_matches(['\r', '\n'])
                    .to_string();
                yield line;
            }
        }
        // 处理末尾不完整行（无换行结尾的情况）
        if !buf.is_empty() {
            let line = String::from_utf8_lossy(&buf).trim_end().to_string();
            if !line.is_empty() {
                yield line;
            }
        }
    }
}