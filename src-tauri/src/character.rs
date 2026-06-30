//! 角色卡解析模块。
//!
//! 兼容 SillyTavern 角色卡格式：
//! - PNG V1/V2（tEXt chunk, keyword = "chara", base64 JSON）
//! - PNG V3  / CharX（tEXt chunk, keyword = "ccv3", base64 JSON）
//! - 纯 JSON 文件
//!
//! 解析策略（对齐 ST 的 extractDataFromPng）：
//! 1. 手动遍历 PNG chunk（不依赖 png crate 的 chunk 迭代器，与 ST 行为一致）
//! 2. 先尝试 "chara"（V1/V2），再尝试 "ccv3"（V3）
//! 3. V1 数据如有嵌套 `.data` 字段则提升为 V2 格式
//!
//! 参考：SillyTavern/public/scripts/utils.js 的 extractDataFromPng 函数

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::storage::CharacterData;

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Base64 decode error: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("No character data found in file")]
    NoCharacterData,
    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),
}

// ---- ST 原始数据格式（兼容 V1 / V2 / V3） ----

/// V1 角色数据（被嵌套在 V1 顶层或 V3 data 中）
/// 注意：部分卡在 V1 层也放了 V2 才有的字段（如 alternate_greetings），
/// 这里做宽松兼容。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct StCharV1 {
    name: String,
    description: String,
    personality: String,
    scenario: String,
    first_mes: String,
    mes_example: String,
    creatorcomment: String,
    #[serde(default)]
    tags: Vec<String>,
    talkativeness: Option<serde_json::Value>,
    fav: Option<serde_json::Value>,
    create_date: Option<String>,

    // V2 字段可能出现在 V1 层（V3 格式 / 非规范卡）
    #[serde(default)]
    alternate_greetings: Vec<String>,
    system_prompt: String,
    creator: String,
    character_version: String,

    // V1 可嵌套 V2 data
    data: Option<StCharV2>,
}

/// V2 角色数据（ST 的标准格式，扩展自 V1）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct StCharV2 {
    name: String,
    description: String,
    personality: String,
    scenario: String,
    first_mes: String,
    mes_example: String,
    creator_notes: String,
    #[serde(default)]
    tags: Vec<String>,
    system_prompt: String,
    post_history_instructions: String,
    creator: String,
    character_version: String,
    #[serde(default)]
    alternate_greetings: Vec<String>,
    character_book: Option<StCharBook>,
}

/// 嵌入的角色世界书
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct StCharBook {
    name: String,
    description: String,
    scan_depth: Option<u32>,
    token_budget: Option<u32>,
    recursive_scanning: Option<bool>,
    extensions: Option<serde_json::Value>,
    entries: Vec<StCharBookEntry>,
}

/// 世界书条目
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct StCharBookEntry {
    id: Option<u32>,
    keys: Vec<String>,
    secondary_keys: Vec<String>,
    comment: String,
    content: String,
    constant: bool,
    selective: bool,
    insertion_order: u32,
    enabled: bool,
    position: String,
    extensions: Option<serde_json::Value>,
}

/// V3 顶层包装（CharX / ccv3）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct StCharV3 {
    spec: String,
    spec_version: String,
    data: StCharV1,  // V3 的 data 段使用 V1 结构
}

/// 导入入口：根据文件扩展名分发
pub fn import_from_path(path: &str) -> Result<CharacterData, ImportError> {
    let path = std::path::Path::new(path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "png" => import_png(path),
        "json" => import_json(path),
        _ => Err(ImportError::UnsupportedFormat(ext)),
    }
}

/// 从 PNG 导入：对齐 ST 的 extractDataFromPng
fn import_png(path: &std::path::Path) -> Result<CharacterData, ImportError> {
    let data = std::fs::read(path)?;
    parse_png_bytes(&data)
}

/// 从 PNG 字节数据解析角色卡（公开给 storage 层用）
pub fn parse_png_bytes(data: &[u8]) -> Result<CharacterData, ImportError> {
    if let Some(json_str) = extract_png_text_chunk_raw(data, "chara") {
        return parse_any(&json_str);
    }
    if let Some(json_str) = extract_png_text_chunk_raw(data, "ccv3") {
        return parse_any(&json_str);
    }
    Err(ImportError::NoCharacterData)
}

/// 手动解析 PNG chunk（公开给 storage 层用）
pub fn extract_png_text_chunk_raw(data: &[u8], identifier: &str) -> Option<String> {
    // PNG signature: 8 bytes
    if data.len() < 8 { return None; }
    if data[0] != 0x89 || data[1] != 0x50 || data[2] != 0x4E || data[3] != 0x47
        || data[4] != 0x0D || data[5] != 0x0A || data[6] != 0x1A || data[7] != 0x0A
    {
        return None;
    }

    let len = data.len();
    let mut idx: usize = 8;
    let id_bytes = identifier.as_bytes();

    while idx + 12 <= len {
        // 4 bytes: chunk length (big-endian)
        let chunk_len = u32::from_be_bytes([data[idx], data[idx + 1], data[idx + 2], data[idx + 3]]) as usize;
        // 4 bytes: chunk type
        let chunk_type = &data[idx + 4..idx + 8];
        // chunk_len bytes: chunk data
        let data_start = idx + 8;
        let data_end = data_start + chunk_len;

        if data_end > len { break; }

        if chunk_type == b"tEXt" {
            let chunk_data = &data[data_start..data_end];
            // tEXt format: keyword\0text
            if let Some(null_pos) = chunk_data.iter().position(|&b| b == 0) {
                let keyword = &chunk_data[..null_pos];
                if keyword == id_bytes {
                    let value = String::from_utf8_lossy(&chunk_data[null_pos + 1..]);
                    return Some(value.to_string());
                }
            }
        }

        // 4 bytes: CRC (skip)
        idx = data_end + 4;
    }

    None
}

/// 从纯 JSON 导入
fn import_json(path: &std::path::Path) -> Result<CharacterData, ImportError> {
    let data = std::fs::read_to_string(path)?;
    parse_any(&data)
}

/// 自动检测 V1/V2/V3 JSON 并解析
fn parse_any(json_str: &str) -> Result<CharacterData, ImportError> {
    let engine = base64::engine::general_purpose::STANDARD;

    // 先尝试 base64 decode（PNG 里存的是 base64，直接 JSON 文件不是）
    let decoded = if let Ok(bytes) = engine.decode(json_str.as_bytes()) {
        String::from_utf8_lossy(&bytes).to_string()
    } else {
        json_str.to_string()
    };

    // 尝试 V3
    if let Ok(v3) = serde_json::from_str::<StCharV3>(&decoded) {
        if !v3.spec.is_empty() || !v3.spec_version.is_empty() {
            return v3_to_character(v3);
        }
        // spec 为空时回退，可能是没有 spec 字段的 V1
    }

    // 尝试 V1（V1 顶层也可能直接是 v2CharData 的格式）
    if let Ok(v1) = serde_json::from_str::<StCharV1>(&decoded) {
        return v1_or_v2_to_character(v1);
    }

    // 尝试 V2 直接（部分工具直接导出 V2 JSON）
    if let Ok(v2) = serde_json::from_str::<StCharV2>(&decoded) {
        return v2_to_character(v2);
    }

    Err(ImportError::NoCharacterData)
}

/// V3 → 统一格式
fn v3_to_character(v3: StCharV3) -> Result<CharacterData, ImportError> {
    // V3 的 data 段是 V1 结构，递归解析
    v1_or_v2_to_character(v3.data)
}

/// V1 → 统一格式（自动处理 V1 嵌套 V2 的情况）
fn v1_or_v2_to_character(v1: StCharV1) -> Result<CharacterData, ImportError> {
    // 如果 V1 内嵌了 V2 data，优先使用 V2，但合并 V1 层的 alternate_greetings
    if let Some(mut v2) = v1.data {
        // 合并：V1 层的备选开场白追加到 V2 后面（去重）
        for g in &v1.alternate_greetings {
            if !v2.alternate_greetings.contains(g) {
                v2.alternate_greetings.push(g.clone());
            }
        }
        // 合并 system_prompt / creator / version（V2 优先）
        if v2.system_prompt.is_empty() { v2.system_prompt = v1.system_prompt; }
        if v2.creator.is_empty() { v2.creator = v1.creator; }
        if v2.character_version.is_empty() { v2.character_version = v1.character_version; }
        return v2_to_character(v2);
    }

    // 否则用 V1 字段（部分字段名与 V2 不同，注意映射）
    let now = now_ms();
    let name = if v1.name.is_empty() { "未命名角色" } else { &v1.name };

    Ok(CharacterData {
        id: format!("char_{}", now),
        name: name.to_string(),
        description: v1.description,
        personality: v1.personality,
        scenario: v1.scenario,
        first_message: v1.first_mes,
        alternate_greetings: v1.alternate_greetings,
        example_messages: v1.mes_example,
        system_prompt: v1.system_prompt,
        tags: v1.tags,
        creator: v1.creator,
        version: if v1.character_version.is_empty() { "1.0".into() } else { v1.character_version },
        kind: "ai".into(),
        icon: detect_icon_str(name),
        avatar_path: None,
        linked_world_book: None,
        created_at: now,
        updated_at: now,
    })
}

/// V2 → 统一格式
fn v2_to_character(v2: StCharV2) -> Result<CharacterData, ImportError> {
    let now = now_ms();
    let name = if v2.name.is_empty() { "未命名角色" } else { &v2.name };

    Ok(CharacterData {
        id: format!("char_{}", now),
        name: name.to_string(),
        description: v2.description,
        personality: v2.personality,
        scenario: v2.scenario,
        first_message: v2.first_mes,
        alternate_greetings: v2.alternate_greetings,
        example_messages: v2.mes_example,
        system_prompt: v2.system_prompt,
        tags: v2.tags,
        creator: v2.creator,
        version: if v2.character_version.is_empty() { "2.0".into() } else { v2.character_version },
        kind: "ai".into(),
        icon: detect_icon_str(name),
        avatar_path: None,
        linked_world_book: None,
        created_at: now,
        updated_at: now,
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 从导入的角色卡中提取并保存嵌入的世界书。
/// 返回世界书名称（如果存在）。
pub async fn import_embedded_world_book(
    file_path: &str,
    character: &CharacterData,
    storage: &crate::storage::Storage,
) -> Result<Option<String>, ImportError> {
    let path = std::path::Path::new(file_path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    let json_str = if ext == "png" {
        let data = std::fs::read(path)?;
        extract_png_text_chunk_raw(&data, "chara")
            .or_else(|| extract_png_text_chunk_raw(&data, "ccv3"))
    } else if ext == "json" {
        Some(std::fs::read_to_string(path)?)
    } else {
        None
    };

    let json_str = match json_str {
        Some(s) => s,
        None => return Ok(None),
    };

    // Base64 decode if needed
    let engine = base64::engine::general_purpose::STANDARD;
    let decoded = if let Ok(bytes) = engine.decode(json_str.as_bytes()) {
        String::from_utf8_lossy(&bytes).to_string()
    } else {
        json_str
    };

    // Try to parse V2 with character_book
    if let Ok(v2) = serde_json::from_str::<StCharV2>(&decoded) {
        if let Some(book) = v2.character_book {
            return import_book_from_data(&book, &character.name, storage).await;
        }
    }

    // Try V1 with nested V2
    if let Ok(v1) = serde_json::from_str::<StCharV1>(&decoded) {
        if let Some(v2) = v1.data {
            if let Some(book) = v2.character_book {
                return import_book_from_data(&book, &character.name, storage).await;
            }
        }
    }

    Ok(None)
}

async fn import_book_from_data(
    book: &StCharBook,
    char_name: &str,
    storage: &crate::storage::Storage,
) -> Result<Option<String>, ImportError> {
    let book_name = if book.name.is_empty() {
        format!("{}'s Lorebook", char_name)
    } else {
        book.name.clone()
    };

    // Convert entries to our format
    let mut entries = Vec::new();
    for (i, entry) in book.entries.iter().enumerate() {
        entries.push(crate::storage::WorldBookEntry {
            id: entry.id.unwrap_or(i as u32),
            keys: entry.keys.clone(),
            secondary_keys: entry.secondary_keys.clone(),
            comment: entry.comment.clone(),
            content: entry.content.clone(),
            constant: entry.constant,
            selective: entry.selective,
            selective_logic: 0,
            insertion_order: entry.insertion_order,
            enabled: entry.enabled,
            position: entry.position.clone(),
        });
    }

    storage.save_world_book(&book_name, &entries).await?;
    Ok(Some(book_name))
}

/// 将 CharacterData 序列化为 ST V2 JSON，返回 base64 字符串（保留用于 PNG 导出）。
#[allow(dead_code)]
pub fn character_to_st_json(character: &CharacterData) -> Result<String, ImportError> {
    let st = StCharV2 {
        name: character.name.clone(),
        description: character.description.clone(),
        personality: character.personality.clone(),
        scenario: character.scenario.clone(),
        first_mes: character.first_message.clone(),
        mes_example: character.example_messages.clone(),
        tags: character.tags.clone(),
        system_prompt: character.system_prompt.clone(),
        creator: character.creator.clone(),
        character_version: character.version.clone(),
        alternate_greetings: character.alternate_greetings.clone(),
        ..Default::default()
    };
    let json = serde_json::to_string(&st)?;
    let engine = base64::engine::general_purpose::STANDARD;
    Ok(engine.encode(json.as_bytes()))
}

/// 将角色数据写入 PNG 文件（保留用于 PNG 导出）。
/// 如果 path 已有 PNG，提取其 IDAT 像素数据保留图像；否则生成 1x1 透明占位图。
#[allow(dead_code)]
pub fn write_character_png(path: &std::path::Path, character: &CharacterData) -> Result<(), ImportError> {
    use std::io::Write;
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    let b64 = character_to_st_json(character)?;

    // 尝试从已有 PNG 提取像素原始数据（原始过滤后的 scanline 数据不好提取，
    // 这里简化：保留原有 IDAT 压缩数据直接复用）
    let idat_data = if path.exists() {
        extract_idat_from_png(path)
    } else {
        None
    };

    let (width, height, raw_pixels) = if let Some((w, h, data)) = idat_data {
        // 直接复用原有压缩数据
        return write_png_with_idat(path, w, h, &b64, &data);
    } else {
        // 新建 1x1 透明像素
        (1u32, 1u32, vec![0u8, 0, 0, 0])
    };

    // 压缩像素数据
    let mut zlib = ZlibEncoder::new(Vec::new(), Compression::default());
    // 每行前面加 filter byte (0 = None)
    for row in raw_pixels.chunks((width * 4) as usize) {
        zlib.write_all(&[0])?;
        zlib.write_all(row)?;
    }
    let compressed = zlib.finish()?;

    write_png_binary(path, width, height, &b64, &compressed)
}

/// 从已有 PNG 提取 IDAT chunk 的压缩数据（用于保留图像）
#[allow(dead_code)]
fn extract_idat_from_png(path: &std::path::Path) -> Option<(u32, u32, Vec<u8>)> {
    let data = std::fs::read(path).ok()?;
    if data.len() < 8 { return None; }

    let mut width = 0u32;
    let mut height = 0u32;
    let mut idat = Vec::new();
    let mut idx = 8usize;

    while idx + 12 <= data.len() {
        let clen = u32::from_be_bytes([data[idx], data[idx+1], data[idx+2], data[idx+3]]) as usize;
        let ctype = &data[idx+4..idx+8];
        let dstart = idx + 8;
        let dend = dstart + clen;
        if dend > data.len() { break; }

        match ctype {
            b"IHDR" if clen >= 8 => {
                width = u32::from_be_bytes([data[dstart], data[dstart+1], data[dstart+2], data[dstart+3]]);
                height = u32::from_be_bytes([data[dstart+4], data[dstart+5], data[dstart+6], data[dstart+7]]);
            }
            b"IDAT" => {
                idat.extend_from_slice(&data[dstart..dend]);
            }
            _ => {}
        }
        idx = dend + 4;
    }

    if width > 0 && height > 0 && !idat.is_empty() {
        Some((width, height, idat))
    } else {
        None
    }
}

/// 使用已有的 IDAT 数据写回 PNG（保留图像，只更换 tEXt chunk）
#[allow(dead_code)]
fn write_png_with_idat(
    path: &std::path::Path,
    width: u32,
    height: u32,
    b64: &str,
    idat: &[u8],
) -> Result<(), ImportError> {
    write_png_binary(path, width, height, b64, idat)
}

/// 写入一个 PNG chunk（数据 = type + payload，不含长度）
#[allow(dead_code)]
fn write_chunk(buf: &mut Vec<u8>, data: &[u8]) {
    let length = (data.len() - 4) as u32;
    buf.extend_from_slice(&length.to_be_bytes());
    buf.extend_from_slice(data);
    let crc = crc32fast::hash(data);
    buf.extend_from_slice(&crc.to_be_bytes());
}

/// 构建并写入 PNG 二进制
#[allow(dead_code)]
fn write_png_binary(
    path: &std::path::Path,
    width: u32,
    height: u32,
    b64: &str,
    idat: &[u8],
) -> Result<(), ImportError> {
    let mut buf = Vec::new();

    // PNG signature
    buf.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(b"IHDR");
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]); // 8bpc, RGBA, deflate, adaptive filter
    write_chunk(&mut buf, &ihdr);

    // tEXt "chara"
    let mut text = Vec::new();
    text.extend_from_slice(b"tEXt");
    text.extend_from_slice(b"chara");
    text.push(0);
    text.extend_from_slice(b64.as_bytes());
    write_chunk(&mut buf, &text);

    // IDAT
    let mut idat_chunk = Vec::new();
    idat_chunk.extend_from_slice(b"IDAT");
    idat_chunk.extend_from_slice(idat);
    write_chunk(&mut buf, &idat_chunk);

    // IEND
    write_chunk(&mut buf, b"IEND");

    std::fs::write(path, &buf)?;
    Ok(())
}

/// 根据角色名推断默认图标
fn detect_icon_str(text: &str) -> String {
    let lower = text.to_lowercase();
    if lower.contains("assistant") || lower.contains("助手") || lower.contains("claude") {
        "smart_toy"
    } else if lower.contains("mage") || lower.contains("wizard") || lower.contains("魔法") || lower.contains("法师") {
        "auto_awesome"
    } else if lower.contains("detective") || lower.contains("侦探") {
        "search"
    } else if lower.contains("warrior") || lower.contains("knight") || lower.contains("战士") || lower.contains("骑士") {
        "shield"
    } else if lower.contains("hacker") || lower.contains("黑客") || lower.contains("cyber") {
        "terminal"
    } else if lower.contains("elf") || lower.contains("精灵") {
        "park"
    } else if lower.contains("demon") || lower.contains("恶魔") || lower.contains("vampire") || lower.contains("吸血鬼") {
        "masks_theater"
    } else {
        "person"
    }.to_string()
}
