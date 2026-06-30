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

export interface WorldBookEntry {
  id: number
  keys: string[]
  secondaryKeys: string[]
  comment: string
  content: string
  constant: boolean
  selective: boolean
  selectiveLogic: number
  insertionOrder: number
  enabled: boolean
  position: string
}

const memBooks = new Map<string, WorldBookEntry[]>()

export async function listWorldBooks(): Promise<string[]> {
  try {
    return await invoke<string[]>('list_world_books')
  } catch {
    return Array.from(memBooks.keys())
  }
}

export async function loadWorldBook(name: string): Promise<WorldBookEntry[]> {
  try {
    return await invoke<WorldBookEntry[]>('load_world_book', { name })
  } catch {
    return memBooks.get(name) ?? []
  }
}

export async function saveWorldBook(name: string, entries: WorldBookEntry[]): Promise<void> {
  try {
    return await invoke<void>('save_world_book_entries', { name, entries })
  } catch {
    memBooks.set(name, entries)
  }
}

export async function deleteWorldBook(name: string): Promise<void> {
  try {
    return await invoke<void>('delete_world_book', { name })
  } catch {
    memBooks.delete(name)
  }
}

export async function createWorldBook(name: string): Promise<void> {
  return saveWorldBook(name, [])
}

export async function renameWorldBook(oldName: string, newName: string): Promise<void> {
  try {
    return await invoke<void>('rename_world_book', { oldName, newName })
  } catch {
    throw new Error('Failed to rename world book')
  }
}
