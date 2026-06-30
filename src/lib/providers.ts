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

export interface ProviderConfig {
  id: string
  name: string
  base_url: string
  api: 'openai-completions' | 'anthropic-messages' | 'google-generative-ai'
  models: ModelDef[]
  auth_header: boolean
}

export interface ModelDef {
  id: string
  name: string
  context_window: number
  max_tokens: number
  reasoning: boolean
}

export async function listProviders(): Promise<ProviderConfig[]> {
  return invoke<ProviderConfig[]>('list_providers')
}

export async function hasApiKey(providerId: string): Promise<boolean> {
  return invoke<boolean>('has_api_key', { providerId })
}

export async function setApiKey(providerId: string, key: string): Promise<void> {
  return invoke<void>('set_api_key', { providerId, key })
}

export async function deleteApiKey(providerId: string): Promise<void> {
  return invoke<void>('delete_api_key', { providerId })
}

export async function updateBaseUrl(providerId: string, baseUrl: string): Promise<void> {
  return invoke<void>('update_provider_base_url', { providerId, baseUrl })
}

export async function fetchModels(baseUrl: string, apiKey: string): Promise<ModelDef[]> {
  return invoke<ModelDef[]>('fetch_models', { baseUrl, apiKey })
}

export async function updateModels(providerId: string, models: ModelDef[]): Promise<void> {
  return invoke<void>('update_provider_models', { providerId, models })
}

export async function testConnection(baseUrl: string, apiKey: string): Promise<[boolean, string]> {
  return invoke<[boolean, string]>('test_connection', { baseUrl, apiKey })
}

export async function updateProviderName(providerId: string, name: string): Promise<void> {
  return invoke<void>('update_provider_name', { providerId, name })
}

export async function registerProvider(provider: ProviderConfig): Promise<void> {
  return invoke<void>('register_provider', { provider })
}


export async function removeProvider(providerId: string): Promise<void> {
  return invoke<void>('remove_provider', { providerId })
}
