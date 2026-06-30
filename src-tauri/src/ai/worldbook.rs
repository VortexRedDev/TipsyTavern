//! World Book scanning and activation engine.
//! Ports the core algorithm from SillyTavern's `world-info.js` `checkWorldInfo()`.
//!
//! MVP scope:
//!   - Key matching (exact, case-sensitive/-insensitive, whole-word)
//!   - Constant entries (always activate)
//!   - Selective logic (AND_ANY / NOT_ALL / NOT_ANY / AND_ALL)
//!   - Recursive scanning (activated entry content feeds back into scan buffer)
//!   - Token budget management
//!   - Position routing (before / after in system prompt)
//!
//! Deferred to later phases:
//!   - Timed effects (sticky, cooldown, delay)
//!   - Inclusion groups with scoring/weighted-random
//!   - Decorators (@@activate / @@dont_activate)
//!   - Regex keys (/pattern/flags)
//!   - Probability rolls
//!   - Min-activations depth extension
//!   - atDepth / EM / AN / outlet positions

use crate::storage::{WorldBookEntry, CharacterData};
use crate::ai::model::CharacterMessage;

/// Global world book settings (persisted as part of app settings JSON).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorldBookSettings {
    #[serde(default = "default_scan_depth")]
    pub scan_depth: usize,
    #[serde(default = "default_budget_pct")]
    pub budget_pct: u8,
    #[serde(default)]
    pub budget_cap: usize,
    #[serde(default)]
    pub recursive: bool,
    #[serde(default = "default_max_recursion_steps")]
    pub max_recursion_steps: usize,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub match_whole_words: bool,
    #[serde(default = "default_format_template")]
    pub format_template: String,
}

fn default_scan_depth() -> usize { 2 }
fn default_budget_pct() -> u8 { 25 }
fn default_max_recursion_steps() -> usize { 5 }
fn default_format_template() -> String { "{0}".to_string() }

impl Default for WorldBookSettings {
    fn default() -> Self {
        Self {
            scan_depth: 2,
            budget_pct: 25,
            budget_cap: 0,
            recursive: false,
            max_recursion_steps: 5,
            case_sensitive: false,
            match_whole_words: false,
            format_template: "{0}".to_string(),
        }
    }
}

/// Result of world book scanning.
#[derive(Debug, Clone, Default)]
pub struct ActivatedWorldInfo {
    pub world_info_before: String,
    pub world_info_after: String,
    pub total_activated: usize,
    pub tokens_used: usize,
}

/// Selective logic modes — aligned with SillyTavern.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SelectiveLogic {
    AndAny = 0,
    NotAll = 1,
    NotAny = 2,
    AndAll = 3,
}

impl From<u8> for SelectiveLogic {
    fn from(v: u8) -> Self {
        match v {
            1 => SelectiveLogic::NotAll,
            2 => SelectiveLogic::NotAny,
            3 => SelectiveLogic::AndAll,
            _ => SelectiveLogic::AndAny,
        }
    }
}

/// Main entry point.
///
/// * `entries` — all entries from a single world book (pre-merged from multiple books)
/// * `messages` — recent chat messages (oldest first)
/// * `character` — character data whose fields are also scanned for keys
/// * `settings` — world book configuration (scan depth, budget, etc.)
/// * `max_tokens` — model's context window length for budget calculation
pub fn scan_and_activate(
    entries: &[WorldBookEntry],
    messages: &[CharacterMessage],
    character: &CharacterData,
    settings: &WorldBookSettings,
    max_tokens: usize,
) -> ActivatedWorldInfo {
    // Build the initial scan buffer
    let scan_text = build_scan_buffer(messages, character, settings.scan_depth);
    let budget = calculate_budget(settings, max_tokens);

    let mut activated_ids: Vec<u32> = Vec::new();
    let mut recursion_text = String::new();

    // Main scanning loop (with optional recursion)
    for step in 0..=settings.max_recursion_steps {
        let buffer = if step == 0 {
            &scan_text
        } else {
            &recursion_text
        };
        if buffer.is_empty() {
            break;
        }

        let mut new_content = String::new();
        let mut activated_this_round = false;

        for entry in entries {
            if !entry.enabled {
                continue;
            }
            if activated_ids.contains(&entry.id) {
                continue;
            }

            let should_activate = if entry.constant {
                true
            } else {
                check_entry_keys(entry, buffer, &scan_text, settings)
            };

            if should_activate {
                activated_ids.push(entry.id);
                activated_this_round = true;
                if settings.recursive {
                    new_content.push_str(&entry.content);
                    new_content.push('\n');
                }
            }
        }

        if !activated_this_round {
            break;
        }
        if settings.recursive && step < settings.max_recursion_steps {
            recursion_text = new_content;
        } else {
            break;
        }
    }

    // Collect activated entries, sort by insertion_order (descending → higher comes first)
    let mut sorted: Vec<&WorldBookEntry> = entries
        .iter()
        .filter(|e| activated_ids.contains(&e.id))
        .collect();
    sorted.sort_by(|a, b| b.insertion_order.cmp(&a.insertion_order));

    let mut before = String::new();
    let mut after = String::new();
    let mut tokens_used: usize = 0;

    for entry in sorted {
        let est_tokens = entry.content.len() / 3;
        if budget > 0 && tokens_used + est_tokens > budget {
            break;
        }
        tokens_used += est_tokens;

        let formatted = wrap_with_template(&entry.content, &settings.format_template);

        match entry.position.as_str() {
            "before_char" | "before_user" => {
                if !before.is_empty() { before.push('\n'); }
                before.push_str(&formatted);
            }
            _ => {
                if !after.is_empty() { after.push('\n'); }
                after.push_str(&formatted);
            }
        }
    }

    ActivatedWorldInfo {
        world_info_before: before,
        world_info_after: after,
        total_activated: activated_ids.len(),
        tokens_used,
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Build the text buffer used for key matching.
/// Includes the last `depth` messages + character description fields.
fn build_scan_buffer(
    messages: &[CharacterMessage],
    character: &CharacterData,
    depth: usize,
) -> String {
    let mut buf = String::new();

    let start = if messages.len() > depth {
        messages.len() - depth
    } else {
        0
    };
    for msg in &messages[start..] {
        if !msg.content.trim().is_empty() {
            buf.push_str(&msg.content);
            buf.push('\n');
        }
    }

    for field in [
        &character.description,
        &character.personality,
        &character.scenario,
        &character.system_prompt,
    ] {
        if !field.trim().is_empty() {
            buf.push_str(field);
            buf.push('\n');
        }
    }

    buf
}

/// Check whether an entry's keys match the scan buffer.
fn check_entry_keys(
    entry: &WorldBookEntry,
    buffer: &str,
    full_buffer: &str,
    settings: &WorldBookSettings,
) -> bool {
    // Must match at least one primary key
    let primary_match = entry
        .keys
        .iter()
        .any(|key| match_key(key, buffer, settings));
    if !primary_match {
        return false;
    }

    // If selective logic is off or there are no secondary keys, we're done
    if !entry.selective || entry.secondary_keys.is_empty() {
        return true;
    }

    let logic = SelectiveLogic::from(entry.selective_logic);
    let secondary_matches: Vec<bool> = entry
        .secondary_keys
        .iter()
        .map(|k| match_key(k, full_buffer, settings))
        .collect();

    match logic {
        SelectiveLogic::AndAny => secondary_matches.iter().any(|&m| m),
        SelectiveLogic::NotAll => secondary_matches.iter().any(|&m| !m),
        SelectiveLogic::NotAny => secondary_matches.iter().all(|&m| !m),
        SelectiveLogic::AndAll => secondary_matches.iter().all(|&m| m),
    }
}

/// Match a single key string against the buffer.
fn match_key(key: &str, buffer: &str, settings: &WorldBookSettings) -> bool {
    let key = key.trim();
    if key.is_empty() {
        return false;
    }

    if settings.match_whole_words {
        if settings.case_sensitive {
            contains_whole_word(key, buffer, false)
        } else {
            contains_whole_word(key, buffer, true)
        }
    } else {
        if settings.case_sensitive {
            buffer.contains(key)
        } else {
            buffer.to_lowercase().contains(&key.to_lowercase())
        }
    }
}

/// Whole-word boundary check.
fn contains_whole_word(haystack: &str, needle: &str, ignore_case: bool) -> bool {
    let h: Vec<char> = if ignore_case {
        haystack.to_lowercase().chars().collect()
    } else {
        haystack.chars().collect()
    };
    let n: Vec<char> = if ignore_case {
        needle.to_lowercase().chars().collect()
    } else {
        needle.chars().collect()
    };
    if n.is_empty() || h.len() < n.len() {
        return false;
    }
    for i in 0..=h.len() - n.len() {
        if h[i..i + n.len()] == n[..] {
            let left_bound = i == 0 || !h[i - 1].is_alphanumeric();
            let right_bound = i + n.len() >= h.len() || !h[i + n.len()].is_alphanumeric();
            if left_bound && right_bound {
                return true;
            }
        }
    }
    false
}

/// Calculate the token budget: pct% of max_tokens, optionally capped.
fn calculate_budget(settings: &WorldBookSettings, max_tokens: usize) -> usize {
    let pct_budget = (max_tokens as u64 * settings.budget_pct as u64 / 100) as usize;
    if settings.budget_cap > 0 {
        pct_budget.min(settings.budget_cap)
    } else {
        pct_budget
    }
}

/// Wrap entry content with the format template. Default "{0}" returns content unchanged.
fn wrap_with_template(content: &str, template: &str) -> String {
    if template.is_empty() || template == "{0}" {
        return content.to_string();
    }
    template.replace("{0}", content)
}
