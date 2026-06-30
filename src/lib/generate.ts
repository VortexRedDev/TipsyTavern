import { loadSettings } from './settings'

let invokeFn: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null

async function ensureTauri() {
  if (invokeFn) return true
  try {
    const api = await import('@tauri-apps/api/core')
    invokeFn = api.invoke
    return true
  } catch { return false }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const ok = await ensureTauri()
  if (!ok) throw new Error('Tauri API not available')
  return invokeFn!(cmd, args) as Promise<T>
}

import { addInspectorEntry } from './inspector'
import { appendDelta as storeDelta, appendThinking as storeThinking, finishStream, streamError, startStream, type ActiveStream } from './active-stream'

interface GenerateEvent {
  type: string
  delta?: string
  content?: string
  partial?: { text: string; thinking: string; input_tokens: number; output_tokens: number }
  reason?: string
  message?: string
  // Inspector fields
  system_prompt?: string
  messages?: { role: string; content: string }[]
  model_id?: string
  provider_id?: string
  character_name?: string | null
  world_info_activated?: number
  world_info_tokens_used?: number
  timestamp?: number
}

const CHANNEL = 'tipsy://generate'

export async function streamGenerate(
  providerId: string,
  modelId: string,
  messages: { role: string; content: string }[],
  characterId: string | null,
  chatId: string,
  streamingKey: string,
  baseMessages: ActiveStream['baseMessages'],
  onDelta: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (msg: string) => void,
  onThinking?: (text: string) => void,
): Promise<void> {
  const { listen } = await import('@tauri-apps/api/event')

  let requestId = ''
  const buffer: GenerateEvent[] = []
  let resolved = false

  const unlisten = await listen<{ request_id: string; event: GenerateEvent }>(CHANNEL, (e) => {
    if (requestId && e.payload.request_id !== requestId) return
    if (!requestId) { buffer.push(e.payload.event); return }
    processEvent(e.payload.event)
    if (buffer.length > 0) { buffer.splice(0).forEach(processEvent) }
  })

  function processEvent(ev: GenerateEvent) {
    if (resolved) return
    switch (ev.type) {
      case 'inspector':
        addInspectorEntry({
          id: requestId,
          systemPrompt: ev.system_prompt ?? '',
          messages: ev.messages ?? [],
          modelId: ev.model_id ?? '',
          providerId: ev.provider_id ?? '',
          characterName: ev.character_name ?? null,
          worldInfoActivated: ev.world_info_activated ?? 0,
          worldInfoTokensUsed: ev.world_info_tokens_used ?? 0,
          timestamp: ev.timestamp ?? Date.now(),
          messageCount: ev.messages?.length ?? 0,
        })
        break
      case 'text_delta': if (ev.delta) { onDelta(ev.delta); storeDelta(chatId, ev.delta) } break
      case 'text_end': if (ev.content) { onDelta(ev.content); storeDelta(chatId, ev.content) } break
      case 'thinking_delta': if (ev.delta) { onThinking?.(ev.delta); storeThinking(chatId, ev.delta) } break
      case 'thinking_end': if (ev.content) { onThinking?.(ev.content); storeThinking(chatId, ev.content) } break
      case 'done': {
        resolved = true
        onDone(ev.partial?.text ?? '')
        finishStream(chatId)
        unlisten()
        break
      }
      case 'error':
        resolved = true
        onError(ev.message ?? 'Unknown error')
        streamError(chatId, ev.message ?? 'Unknown error')
        unlisten()
        break
    }
  }

  try {
    startStream(chatId, streamingKey, baseMessages)
    requestId = await invoke<string>('generate', {
      request: {
        provider_id: providerId,
        model_id: modelId,
        context: { messages },
        settings: {},
        character_id: characterId ?? undefined,
      },
    })
    if (buffer.length > 0) { buffer.splice(0).forEach(processEvent) }
  } catch (e) {
    unlisten()
    throw e
  }
}

export async function getDefaultModel() {
  const settings = await loadSettings()
  return settings.defaultChatModel ?? null
}
