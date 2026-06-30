import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, RefreshCw, Wifi, Plus, Trash2 } from 'lucide-react'
import { listProviders, hasApiKey, setApiKey, deleteApiKey, updateBaseUrl, updateProviderName, fetchModels, updateModels, testConnection, registerProvider, removeProvider, type ProviderConfig } from '../../lib/providers'
import { loadSettings, saveSettings, type WorldBookSettings } from '../../lib/settings'
import { getStoredTheme, type Theme, applyAccent, getStoredAccent, ACCENT_NAMES, getAccentColor } from '../../components/ThemeProvider'
import type React from 'react'

type Props = { selectedItemId: string }

const BUILTIN_IDS = ['openai', 'anthropic', 'google', 'openrouter']

const MOCK_PROVIDERS: ProviderConfig[] = [
  { id: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', api: 'openai-completions', models: [], auth_header: true },
  { id: 'anthropic', name: 'Anthropic (Claude)', base_url: 'https://api.anthropic.com/v1', api: 'anthropic-messages', models: [], auth_header: true },
  { id: 'google', name: 'Google (Gemini)', base_url: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-generative-ai', models: [], auth_header: true },
  { id: 'openrouter', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', api: 'openai-completions', models: [], auth_header: true },
]

function isBuiltin(id: string) { return BUILTIN_IDS.includes(id) }

export function SettingsWorkspace({ selectedItemId }: Props) {
  if (selectedItemId === '1') return <ModelProviders />
  if (selectedItemId === '2') return <WorldBookSettingsPanel />
  if (selectedItemId === '3') return <ThemeSettings />
  if (selectedItemId === '4') return <AboutPage />
  return <div className="flex flex-1 items-center justify-center text-text-muted text-[14px]">Coming soon.</div>
}

function ModelProviders() {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [hasKeys, setHasKeys] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; detail: string } | null>>({})
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({})
  const [customName, setCustomName] = useState('')
  const [defaultModel, setDefaultModel] = useState<{ providerId: string; modelId: string; modelName: string; providerName: string } | null>(null)

  const refresh = () => {
    listProviders()
      .then((data) => {
        const sorted = [...data].sort((a, b) => {
          const aB = Number(isBuiltin(a.id))
          const bB = Number(isBuiltin(b.id))
          if (aB !== bB) return bB - aB
          return a.name.localeCompare(b.name)
        })
        setProviders(sorted.length ? sorted : MOCK_PROVIDERS)
        data.forEach((p) => {
          hasApiKey(p.id).then((h) => setHasKeys((prev) => ({ ...prev, [p.id]: h })))
        })
      })
      .catch(() => setProviders(MOCK_PROVIDERS))
      .finally(() => setLoading(false))
    loadSettings()
      .then((s) => { if (s.defaultChatModel) setDefaultModel(s.defaultChatModel) })
      .catch(() => {})
  }

  useEffect(() => { refresh() }, [])

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    setProviders((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p))
  }

  const handleBaseUrlChange = (id: string, url: string) => {
    updateProvider(id, { base_url: url })
    updateBaseUrl(id, url).catch(() => {})
  }

  const handleNameChange = (id: string, name: string) => {
    updateProvider(id, { name })
    updateProviderName(id, name).catch(() => {})
  }

  const handleSetKey = async (id: string, key: string) => {
    setKeys((prev) => ({ ...prev, [id]: key }))
    if (key) {
      await setApiKey(id, key).catch(() => {})
      setHasKeys((prev) => ({ ...prev, [id]: true }))
    } else {
      await deleteApiKey(id).catch(() => {})
      setHasKeys((prev) => ({ ...prev, [id]: false }))
    }
  }

  const handleFetchModels = async (id: string) => {
    const p = providers.find((pr) => pr.id === id)
    if (!p) return
    setFetchingModels((prev) => ({ ...prev, [id]: true }))
    const apiKey = keys[id] || ''
    try {
      const models = await fetchModels(p.base_url, apiKey)
      updateProvider(id, { models })
      updateModels(id, models).catch(() => {})
    } catch {}
    setFetchingModels((prev) => ({ ...prev, [id]: false }))
  }

  const handleTest = async (id: string) => {
    const p = providers.find((pr) => pr.id === id)
    if (!p) return
    const apiKey = keys[id] || ''
    try {
      const [ok, detail] = await testConnection(p.base_url, apiKey)
      setTestResults((prev) => ({ ...prev, [id]: { ok, detail } }))
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, detail: 'Connection failed' } }))
    }
  }

  const handleAddCustom = async () => {
    const name = customName.trim() || 'Custom Provider'
    const id = 'custom_' + Date.now()
    const provider: ProviderConfig = {
      id, name, base_url: 'http://localhost:8080/v1',
      api: 'openai-completions', models: [], auth_header: true,
    }
    try { await registerProvider(provider) } catch {}
    setProviders((prev) => [...prev, provider])
    setCustomName('')
    setExpandedId(id)
  }

  const handleRemove = async (id: string) => {
    try { await removeProvider(id) } catch {}
    setProviders((prev) => prev.filter((p) => p.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const handleSetDefaultModel = (model: { providerId: string; modelId: string; modelName: string; providerName: string } | null) => {
    setDefaultModel(model)
    saveSettings({ defaultChatModel: model ?? undefined }).catch(() => {})
  }

  // Build model options from all providers
  const modelOptions: { providerId: string; providerName: string; modelId: string; modelName: string }[] = []
  providers.forEach((p) => {
    p.models.forEach((m) => {
      modelOptions.push({ providerId: p.id, providerName: p.name, modelId: m.id, modelName: m.name || m.id })
    })
  })

  const elements: React.ReactNode[] = []
  providers.forEach((p, i) => {
    const prevBuiltin = i === 0 || isBuiltin(providers[i - 1].id)
    if (!isBuiltin(p.id) && prevBuiltin) {
      elements.push(
        <div key="custom-divider" className="flex items-center gap-3 py-2">
          <div className="flex-1 border-t border-border" />
          <span className="text-[11px] text-text-muted font-medium">Custom</span>
          <div className="flex-1 border-t border-border" />
        </div>
      )
    }

    const isExpanded = expandedId === p.id
    const status = testResults[p.id]
    const builtin = isBuiltin(p.id)
    elements.push(
      <div key={p.id} className="rounded-lg border border-border bg-surface">
        <div
          onClick={() => setExpandedId(isExpanded ? null : p.id)}
          className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer ${isExpanded ? 'border-b border-border' : ''}`}
        >
          <button className="shrink-0 text-text-muted">
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <span className="flex-1 text-[14px] text-text font-medium">{p.name}</span>
          {status && (
            <span className={`flex items-center gap-1 text-[12px] ${status.ok ? 'text-green-600' : 'text-red-500'}`}>
              <span className={`inline-block h-2 w-2 rounded-full ${status.ok ? 'bg-green-500' : 'bg-red-500'}`} />
              {status.ok ? 'Connected' : status.detail}
            </span>
          )}
          {hasKeys[p.id] && <span className="text-[11px] text-text-muted">🔑</span>}
        </div>
        {isExpanded && (
          <div className="px-4 py-3 space-y-3">
            <Field label="Provider Name">
              <input value={p.name} onChange={(e) => handleNameChange(p.id, e.target.value)} disabled={builtin}
                className={`w-full rounded-lg border px-3 py-1.5 text-[14px] outline-none ${builtin ? 'bg-transparent border-transparent text-text-muted cursor-default' : 'border-border bg-input text-text focus:border-accent/50'}`} />
            </Field>
            <Field label="Base URL">
              <input value={p.base_url} onChange={(e) => handleBaseUrlChange(p.id, e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-1.5 text-[14px] text-text outline-none focus:border-accent/50" />
            </Field>
            <Field label="API Key">
              <div className="flex gap-1.5">
                <input type={showKeys[p.id] ? 'text' : 'password'} value={keys[p.id] ?? ''}
                  onChange={(e) => handleSetKey(p.id, e.target.value)}
                  placeholder={hasKeys[p.id] ? '(key stored in keychain)' : 'Enter API key...'}
                  className="flex-1 rounded-lg border border-border bg-input px-3 py-1.5 text-[14px] text-text outline-none focus:border-accent/50" />
                <button onClick={() => setShowKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-input">
                  {showKeys[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>
            {p.models.length > 0 && (
              <Field label="Models">
                <div className="flex flex-wrap gap-1.5">
                  {p.models.map((m) => (
                    <span key={m.id} className="inline-flex items-center rounded-md bg-accent/5 border border-accent/20 px-2 py-0.5 text-[12px] text-accent">
                      {m.name || m.id}
                    </span>
                  ))}
                </div>
              </Field>
            )}
            <div className="flex items-center gap-2">
              <button onClick={() => handleFetchModels(p.id)} disabled={fetchingModels[p.id]}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-input px-3 py-1.5 text-[13px] text-text hover:bg-surface disabled:opacity-50 transition-colors">
                <RefreshCw size={13} className={fetchingModels[p.id] ? 'animate-spin' : ''} /> Fetch Models
              </button>
              <button onClick={() => handleTest(p.id)}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-input px-3 py-1.5 text-[13px] text-text hover:bg-surface transition-colors">
                <Wifi size={13} /> Test Connection
              </button>
              {status && (
                <span className={`text-[12px] ${status.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {status.ok ? `OK (${status.detail})` : status.detail}
                </span>
              )}
              {!builtin && (
                <button onClick={() => handleRemove(p.id)}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded text-text-muted hover:text-red-500 hover:bg-red-50">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  })

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="z-10 border-b border-border bg-surface px-6 py-3 shrink-0">
        <h2 className="text-[15px] font-medium text-text-heading">Model Providers</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
          </div>
        ) : (
          <>
            {/* Default Models */}
            <div className="rounded-lg border border-border bg-surface p-4 space-y-3 mb-4">
              <h3 className="text-[13px] font-semibold text-text-heading">Default Models</h3>
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-text-muted w-24 shrink-0">Chat</span>
                <select
                  value={defaultModel ? `${defaultModel.providerId}::${defaultModel.modelId}` : ''}
                  onChange={(e) => {
                    const val = e.target.value
                    if (!val) { handleSetDefaultModel(null); return }
                    const opt = modelOptions.find((o) => `${o.providerId}::${o.modelId}` === val)
                    if (opt) handleSetDefaultModel(opt)
                  }}
                  className="flex-1 rounded-lg border border-border bg-input px-3 py-1.5 text-[14px] text-text outline-none"
                >
                  <option value="">— Not set —</option>
                  {modelOptions.map((o) => (
                    <option key={`${o.providerId}::${o.modelId}`} value={`${o.providerId}::${o.modelId}`}>
                      {o.providerName} · {o.modelName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Providers divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 border-t border-border" />
              <span className="text-[11px] text-text-muted font-medium">Providers</span>
              <div className="flex-1 border-t border-border" />
            </div>

            {elements}
          </>
        )}

        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-2">
          <input value={customName} onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustom() }}
            placeholder="New provider name..." className="flex-1 bg-transparent px-2 py-1 text-[13px] text-text placeholder:text-text-muted outline-none" />
          <button onClick={handleAddCustom}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 transition-opacity">
            <Plus size={14} /> Add
          </button>
        </div>
      </div>
    </div>
  )
}

function AboutPage() {
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="z-10 border-b border-border bg-surface px-6 py-3 shrink-0">
        <h2 className="text-[15px] font-medium text-text-heading">About</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
          <div>
            <h3 className="text-[20px] font-medium text-text-heading">TipsyTavern</h3>
            <p className="mt-1 text-[13px] text-text-muted">v0.1.0</p>
          </div>
          <p className="text-[14px] text-text leading-relaxed">
            A desktop AI chat client inspired by SillyTavern. Built with Tauri + React + Rust.
          </p>
          <div className="space-y-2 text-[13px] text-text">
            <div className="flex items-center gap-2">
              <span className="text-text-muted w-20 shrink-0">Framework</span>
              <span>Tauri 2 + React 19 + TypeScript</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted w-20 shrink-0">Backend</span>
              <span>Rust (reqwest + tokio)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted w-20 shrink-0">LLM Support</span>
              <span>OpenAI · Anthropic · Gemini · OpenRouter + compatible APIs</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted w-20 shrink-0">Features</span>
              <span>Character Cards · World Books · Personas · Streaming · Inspector</span>
            </div>
          </div>
          <div className="pt-2 border-t border-border">
            <a href="https://github.com/anomalyco/opencode/issues" target="_blank"
              className="text-[13px] text-accent hover:underline">
              Report an issue →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemeSettings() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme())
  const [accent, setAccent] = useState(getStoredAccent())

  const handleChange = (t: Theme) => {
    setTheme(t)
    const root = document.documentElement
    const isDark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    root.classList.toggle('dark', isDark)
    try { localStorage.setItem('theme', t) } catch {}
  }

  const handleAccent = (a: string) => {
    setAccent(a)
    applyAccent(a)
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="z-10 border-b border-border bg-surface px-6 py-3 shrink-0">
        <h2 className="text-[15px] font-medium text-text-heading">Theme</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          {([
            ['system', 'Follow System'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ] as [Theme, string][]).map(([value, label]) => (
            <label key={value} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => handleChange(value)}
                className="h-4 w-4 accent-accent"
              />
              <span className="text-[14px] text-text">{label}</span>
            </label>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Accent Color</span>
          <div className="mt-3 flex flex-wrap gap-2">
            {ACCENT_NAMES.map((a) => (
                <button
                  key={a}
                  onClick={() => handleAccent(a)}
                  title={a}
                  className={`h-7 w-7 rounded-full transition-all ${
                    accent === a
                      ? 'ring-2 ring-offset-2 ring-accent scale-110'
                      : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: getAccentColor(a), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)' }}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function WorldBookSettingsPanel() {
  const [settings, setSettings] = useState<WorldBookSettings>({
    scanDepth: 2,
    budgetPct: 25,
    budgetCap: 0,
    recursive: false,
    maxRecursionSteps: 5,
    caseSensitive: false,
    matchWholeWords: false,
    formatTemplate: '{0}',
  })

  useEffect(() => {
    loadSettings()
      .then((s) => { if (s.worldBookSettings) setSettings(s.worldBookSettings) })
      .catch(() => {})
  }, [])

  const update = (patch: Partial<WorldBookSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings({ worldBookSettings: next }).catch(() => {})
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="z-10 border-b border-border bg-surface px-6 py-3 shrink-0">
        <h2 className="text-[15px] font-medium text-text-heading">World Book Settings</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
          <Field label="Scan Depth">
            <p className="text-[12px] text-text-muted mb-1">How many recent messages to scan for key matches.</p>
            <input type="number" min={0} max={50} value={settings.scanDepth}
              onChange={(e) => update({ scanDepth: Number(e.target.value) || 0 })}
              className="w-24 rounded-lg border border-border bg-input px-3 py-1.5 text-[14px] text-text outline-none focus:border-accent/50" />
          </Field>

          <Field label="Token Budget (%)">
            <p className="text-[12px] text-text-muted mb-1">Maximum percentage of the context window to use for world book entries.</p>
            <input type="number" min={0} max={100} value={settings.budgetPct}
              onChange={(e) => update({ budgetPct: Number(e.target.value) || 0 })}
              className="w-24 rounded-lg border border-border bg-input px-3 py-1.5 text-[14px] text-text outline-none focus:border-accent/50" />
          </Field>

          <Field label="Token Budget Cap">
            <p className="text-[12px] text-text-muted mb-1">Absolute token limit (0 = no cap, only percentage applies).</p>
            <input type="number" min={0} value={settings.budgetCap}
              onChange={(e) => update({ budgetCap: Number(e.target.value) || 0 })}
              className="w-24 rounded-lg border border-border bg-input px-3 py-1.5 text-[14px] text-text outline-none focus:border-accent/50" />
          </Field>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="wi-recursive" checked={settings.recursive}
              onChange={(e) => update({ recursive: e.target.checked })}
              className="h-4 w-4 rounded border-border accent-accent" />
            <label htmlFor="wi-recursive" className="text-[14px] text-text">Recursive scanning</label>
          </div>

          {settings.recursive && (
            <Field label="Max Recursion Steps">
              <p className="text-[12px] text-text-muted mb-1">How many times activated entries can re-trigger scanning.</p>
              <input type="number" min={0} max={20} value={settings.maxRecursionSteps}
                onChange={(e) => update({ maxRecursionSteps: Number(e.target.value) || 0 })}
                className="w-24 rounded-lg border border-border bg-input px-3 py-1.5 text-[14px] text-text outline-none focus:border-accent/50" />
            </Field>
          )}

          <div className="flex items-center gap-3">
            <input type="checkbox" id="wi-case-sensitive" checked={settings.caseSensitive}
              onChange={(e) => update({ caseSensitive: e.target.checked })}
              className="h-4 w-4 rounded border-border accent-accent" />
            <label htmlFor="wi-case-sensitive" className="text-[14px] text-text">Case sensitive key matching</label>
          </div>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="wi-whole-word" checked={settings.matchWholeWords}
              onChange={(e) => update({ matchWholeWords: e.target.checked })}
              className="h-4 w-4 rounded border-border accent-accent" />
            <label htmlFor="wi-whole-word" className="text-[14px] text-text">Match whole words only</label>
          </div>

          <Field label="Format Template">
            <p className="text-[12px] text-text-muted mb-1">Wrap each activated entry. Use {`{0}`} for the entry content. Default {`{0}`} = no wrapping.</p>
            <input value={settings.formatTemplate}
              onChange={(e) => update({ formatTemplate: e.target.value })}
              placeholder="{0}"
              className="w-full rounded-lg border border-border bg-input px-3 py-1.5 text-[14px] text-text placeholder:text-text-muted outline-none focus:border-accent/50" />
          </Field>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  )
}
