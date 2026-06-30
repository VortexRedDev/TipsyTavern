let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null

async function ensureTauri() {
  if (tauriInvoke) return true
  try {
    const api = await import('@tauri-apps/api/core')
    tauriInvoke = api.invoke
    return true
  } catch {
    return false
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const ok = await ensureTauri()
  if (!ok) throw new Error('Tauri API not available')
  return tauriInvoke!(cmd, args) as Promise<T>
}

export interface ChatIndexEntry {
  id: string
  title: string
  character_id: string
  created_at: number
  updated_at: number
}

export interface CharacterMessage {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  swipes: string[]
  current_swipe_index: number
  reasoning?: string
  timestamp?: number
}

export interface ChatData {
  id: string
  title: string
  character_id: string
  created_at: number
  updated_at: number
  messages: CharacterMessage[]
}

const memChats: ChatData[] = []

export function createChatId(): string {
  return crypto.randomUUID()
}

export async function listChats(): Promise<ChatIndexEntry[]> {
  try {
    return await invoke<ChatIndexEntry[]>('list_chats')
  } catch {
    return memChats.map(({ id, title, character_id, created_at, updated_at }) =>
      ({ id, title, character_id, created_at, updated_at }))
  }
}

export async function loadChat(chatId: string): Promise<ChatData | null> {
  try {
    return await invoke<ChatData | null>('load_chat', { chatId })
  } catch {
    return memChats.find((c) => c.id === chatId) ?? null
  }
}

export async function saveChat(chat: ChatData): Promise<void> {
  try {
    return await invoke<void>('save_chat', { chat })
  } catch {
    const idx = memChats.findIndex((c) => c.id === chat.id)
    if (idx >= 0) memChats[idx] = chat
    else memChats.push(chat)
  }
}

export async function deleteChat(chatId: string): Promise<void> {
  try {
    return await invoke<void>('delete_chat', { chatId })
  } catch {
    const idx = memChats.findIndex((c) => c.id === chatId)
    if (idx >= 0) memChats.splice(idx, 1)
  }
}
