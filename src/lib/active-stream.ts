import type { CharacterMessage } from './chats'

export interface ActiveStream {
  chatId: string
  streamingKey: string
  baseMessages: CharacterMessage[]
  streamingText: string
  streamingThinking: string
  error: string | null
  done: boolean
}

const streams = new Map<string, ActiveStream>()
let listeners: Array<() => void> = []

export function getActiveStream(chatId: string): ActiveStream | null {
  return streams.get(chatId) ?? null
}

export function startStream(chatId: string, streamingKey: string, baseMessages: CharacterMessage[]) {
  streams.set(chatId, {
    chatId,
    streamingKey,
    baseMessages,
    streamingText: '',
    streamingThinking: '',
    error: null,
    done: false,
  })
  notify()
}

export function appendDelta(chatId: string, text: string) {
  const s = streams.get(chatId)
  if (!s) return
  s.streamingText += text
  notify()
}

export function appendThinking(chatId: string, text: string) {
  const s = streams.get(chatId)
  if (!s) return
  s.streamingThinking += text
  notify()
}

export function finishStream(chatId: string) {
  const s = streams.get(chatId)
  if (!s) return
  s.done = true
  notify()
}

export function streamError(chatId: string, msg: string) {
  const s = streams.get(chatId)
  if (!s) return
  s.error = msg
  s.done = true
  notify()
}

export function clearStream(chatId: string) {
  streams.delete(chatId)
  notify()
}

export function subscribe(fn: () => void) {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}

function notify() {
  listeners.forEach((fn) => fn())
}
