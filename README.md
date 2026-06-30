# TipsyTavern

A desktop AI chat client for immersive roleplaying — character cards, world books, personas, and multi-provider LLM streaming. Built with Tauri, React, and Rust.

## Features

- **Character Cards** — Import PNG V1/V2/V3 character cards (SillyTavern compatible). Description, personality, scenario, and avatar all work out of the box.
- **World Books** — Keyword-activated lore injection with recursive scanning, token budgeting, and customizable format templates.
- **Personas** — User profiles with avatar, description, and linked world books. Injects into the system prompt for AI awareness.
- **Multi-Provider Streaming** — Supports OpenAI, Anthropic Claude, Google Gemini, OpenRouter, and any OpenAI-compatible API. SSE streaming with thinking/CoT support.
- **Inspector** — Real-time context inspection. See exactly what gets sent to the LLM on every request.
- **Themes** — Light, Dark, and System theme modes with 10 accent colors.
- **Layouts** — Bubble and document (flat) chat views.
- **Greeting Switcher** — Cycle through character alternate greetings before starting a conversation.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri 2 |
| Frontend | React 19 · TypeScript · Tailwind CSS 4 |
| Backend | Rust · reqwest · tokio · serde |
| LLM APIs | OpenAI · Anthropic · Gemini · OpenRouter |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) (stable)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

## Development

```bash
# Install dependencies
npm install

# Run in dev mode (with hot reload)
npm run tauri dev

# Build for production
npm run tauri build
```

## Project Structure

```
TipsyTavern/
  src/                     # React frontend
    components/            # Shared UI components
    features/              # Feature modules
      chat/                # Chat interface
      characters/          # Character editor
      worldbook/           # World book editor
      personas/            # Persona editor
      inspector/           # Context inspector
      settings/            # App settings
    lib/                   # Shared libraries & API layer
  src-tauri/               # Rust backend
    src/
      ai/                  # LLM provider abstraction
        providers/         # OpenAI / Anthropic / Gemini implementations
      commands.rs          # Tauri IPC command handlers
      storage.rs           # File-backed persistence layer
      character.rs         # Character card parser (PNG V1/V2/V3)
```

## Acknowledgments

Inspired by [SillyTavern](https://github.com/SillyTavern/SillyTavern), the open-source AI chat platform. Thanks to the ST community for establishing the character card and world book formats this project builds upon.

## License

MIT
