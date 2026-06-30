//! Context assembly pipeline.
//!
//! Composes the full LLM prompt from:
//!   1. Character system prompt
//!   2. World info (before) — activated WI entries with position=before_*
//!   3. Character description / personality / scenario
//!   4. World info (after)  — activated WI entries with position=after_* / in_char
//!   5. Chat messages (passed through as-is)
//!
//! The result goes into `GenerateContext.system` for OpenAI/Anthropic/Google providers.

use crate::storage::{CharacterData, WorldBookEntry};
use crate::ai::model::{CharacterMessage, GenerateContext};
use crate::ai::worldbook::{self, ActivatedWorldInfo, WorldBookSettings};

#[derive(Debug, Clone)]
pub struct AssembledContext {
    pub context: GenerateContext,
    pub world_info: ActivatedWorldInfo,
}

pub fn assemble(
    messages: Vec<CharacterMessage>,
    character: &CharacterData,
    worldbook_entries: &[WorldBookEntry],
    settings: &WorldBookSettings,
    model_max_tokens: usize,
) -> AssembledContext {
    let wi = worldbook::scan_and_activate(
        worldbook_entries,
        &messages,
        character,
        settings,
        model_max_tokens,
    );

    let system = build_system_prompt(character, &wi);
    let context = GenerateContext {
        system,
        messages,
        ..Default::default()
    };

    AssembledContext { context, world_info: wi }
}

/// Build the system prompt string by concatenating parts in the canonical order.
fn build_system_prompt(character: &CharacterData, wi: &ActivatedWorldInfo) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();

    // 1. Character's custom system prompt (if set)
    let sp = character.system_prompt.trim();
    if !sp.is_empty() {
        parts.push(sp.to_string());
    }

    // 2. World info before (before the character description)
    let wi_before = wi.world_info_before.trim();
    if !wi_before.is_empty() {
        parts.push(wi_before.to_string());
    }

    // 3. Character description
    let desc = character.description.trim();
    if !desc.is_empty() {
        parts.push(format!("[Character: {}]", desc));
    }

    // 4. Personality
    let pers = character.personality.trim();
    if !pers.is_empty() {
        parts.push(format!("[Personality: {}]", pers));
    }

    // 5. Scenario
    let scen = character.scenario.trim();
    if !scen.is_empty() {
        parts.push(format!("[Scenario: {}]", scen));
    }

    // 6. World info after
    let wi_after = wi.world_info_after.trim();
    if !wi_after.is_empty() {
        parts.push(wi_after.to_string());
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}
