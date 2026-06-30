import type { CharacterData, CharacterIndexEntry } from '../types'

let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null
let tauriOpen: ((options: unknown) => Promise<string | null>) | null = null

async function ensureTauri() {
  if (tauriInvoke) return true
  try {
    const api = await import('@tauri-apps/api/core')
    const dialog = await import('@tauri-apps/plugin-dialog')
    tauriInvoke = api.invoke
    tauriOpen = (opts: unknown) => dialog.open(opts as Parameters<typeof dialog.open>[0])
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

export async function openFileDialog(): Promise<string | null> {
  const ok = await ensureTauri()
  if (!ok) return null
  return tauriOpen!({
    filters: [{ name: 'Character Cards', extensions: ['png', 'json'] }],
  })
}

export async function importCharacter(filePath: string): Promise<CharacterData> {
  return invoke<CharacterData>('import_character', { filePath })
}

export async function listCharacters(): Promise<CharacterIndexEntry[]> {
  return invoke<CharacterIndexEntry[]>('list_characters')
}

export async function loadCharacter(id: string): Promise<CharacterData | null> {
  try { return await invoke<CharacterData | null>('load_character', { charId: id }) }
  catch { return MOCK[id] ?? null }
}

const MOCK: Record<string, CharacterData> = {
  '1': {
    id: '1', name: 'Lyra the Bard', kind: 'ai', icon: 'music_note',
    description: 'A wandering minstrel from the Silver Coast.',
    personality: '', scenario: '',
    firstMessage: "Hey there! I'm Lyra, a wandering bard from the Silver Coast. What tales shall we spin today?",
    alternateGreetings: [], exampleMessages: '', systemPrompt: '',
    tags: ['fantasy', 'bard', 'adventure', 'music'],
    creator: 'TipsyTavern', version: '1.0',
    avatarPath: null, linkedWorldBook: 'The Kingdom of Aldoria',
    createdAt: 0, updatedAt: 0,
  },
  '2': {
    id: '2', name: 'Thorne the Knight', kind: 'ai', icon: 'shield',
    description: 'A stoic knight of the Crimson Order.',
    personality: '', scenario: '',
    firstMessage: 'State your name and business, traveler.',
    alternateGreetings: [], exampleMessages: '', systemPrompt: '',
    tags: ['fantasy', 'knight', 'drama'],
    creator: '', version: '',
    avatarPath: null, linkedWorldBook: null,
    createdAt: 0, updatedAt: 0,
  },
  '3': {
    id: '3', name: 'Elara the Mage', kind: 'ai', icon: 'auto_awesome',
    description: 'A brilliant but eccentric archmage.',
    personality: '', scenario: '',
    firstMessage: 'Ah! Perfect timing. Tell me — do you believe that reality is a tapestry or a river?',
    alternateGreetings: [], exampleMessages: '', systemPrompt: '',
    tags: ['fantasy', 'mage', 'magic'],
    creator: '', version: '',
    avatarPath: null, linkedWorldBook: 'Magic System: Arcanum',
    createdAt: 0, updatedAt: 0,
  },
}

export async function saveCharacter(character: CharacterData): Promise<void> {
  return invoke<void>('save_character', { character })
}

export async function deleteCharacter(id: string): Promise<void> {
  return invoke<void>('delete_character', { charId: id })
}

export interface CharacterWorldBooks {
  primary: string | null
  auxiliary: string[]
  source: string
}

export async function getCharacterWorldBooks(charId: string): Promise<CharacterWorldBooks> {
  try {
    return await invoke<CharacterWorldBooks>('get_character_world_books', { charId })
  } catch {
    return { primary: null, auxiliary: [], source: 'none' }
  }
}

export async function setCharacterWorldBook(charId: string, worldBook: string | null): Promise<void> {
  return invoke<void>('set_character_world_book', { charId, worldBook })
}
