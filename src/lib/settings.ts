let invokeFn: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null

async function ensureTauri() {
  if (invokeFn) return true
  try {
    const api = await import('@tauri-apps/api/core')
    invokeFn = api.invoke
    return true
  } catch {
    return false
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const ok = await ensureTauri()
  if (!ok) throw new Error('Tauri API not available')
  return invokeFn!(cmd, args) as Promise<T>
}

export interface WorldBookSettings {
  scanDepth: number
  budgetPct: number
  budgetCap: number
  recursive: boolean
  maxRecursionSteps: number
  caseSensitive: boolean
  matchWholeWords: boolean
  formatTemplate: string
}

export interface AppSettings {
  defaultChatModel?: { providerId: string; modelId: string; modelName: string; providerName: string }
  worldBookSettings?: WorldBookSettings
  activePersonaId?: string
}

let cached: AppSettings | null = null

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await invoke<AppSettings>('load_app_settings')
    cached = raw
    return raw
  } catch {
    return cached ?? {}
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  cached = settings
  return invoke<void>('save_app_settings', { settings }).catch(() => {})
}
