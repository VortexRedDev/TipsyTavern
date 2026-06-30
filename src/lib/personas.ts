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

export interface PersonaData {
  id: string
  name: string
  description: string
  avatarPath: string | null
  position: string
  linkedWorldBook: string | null
  createdAt: number
  updatedAt: number
}

export interface PersonaIndexEntry {
  id: string
  name: string
  created_at: number
  updated_at: number
}

export function createPersonaId(): string {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export async function listPersonas(): Promise<PersonaIndexEntry[]> {
  return invoke<PersonaIndexEntry[]>('list_personas')
}

export async function loadPersona(id: string): Promise<PersonaData | null> {
  try { return await invoke<PersonaData | null>('load_persona', { id }) }
  catch { return null }
}

export async function savePersona(persona: PersonaData): Promise<void> {
  return invoke<void>('save_persona', { persona })
}

export async function deletePersona(id: string): Promise<void> {
  return invoke<void>('delete_persona', { id })
}
