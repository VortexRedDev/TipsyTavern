import { useState, useEffect } from 'react'
import { Save, Trash2, Image } from 'lucide-react'
import { loadPersona, savePersona, deletePersona, type PersonaData } from '../../lib/personas'
import { loadSettings, saveSettings } from '../../lib/settings'
import { WorldBookComboBox } from '../characters/WorldBookComboBox'

let convertFileSrc: ((path: string) => string) | null = null
let dialogOpen: ((opts: { filters: { name: string; extensions: string[] }[] }) => Promise<string | null>) | null = null
import('@tauri-apps/api/core').then(m => { convertFileSrc = m.convertFileSrc }).catch(() => {})
import('@tauri-apps/plugin-dialog').then(m => { dialogOpen = m.open as typeof dialogOpen }).catch(() => {})

type Props = {
  selectedItemId: string
  onDeleted?: () => void
  onSaved?: () => void
}

const POSITIONS = ['in_prompt', 'disabled']

export function PersonaWorkspace({ selectedItemId, onDeleted, onSaved }: Props) {
  const [persona, setPersona] = useState<PersonaData | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadPersona(selectedItemId)
      .then((data) => { if (!cancelled) setPersona(data) })
      .catch(() => {})
    loadSettings()
      .then((s) => { if (!cancelled) setActiveId(s.activePersonaId ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedItemId])

  if (!persona) {
    return <div className="flex flex-1 items-center justify-center text-text-muted text-[14px]">Persona not found.</div>
  }

  const update = (patch: Partial<PersonaData>) => setPersona((p) => p ? { ...p, ...patch } : p)

  const handleSave = () => {
    const toSave = { ...persona, updatedAt: Date.now() }
    savePersona(toSave).then(() => onSaved?.()).catch(() => {})
    setPersona(toSave)
  }

  const handleDelete = async () => {
    await deletePersona(persona.id).catch(() => {})
    if (activeId === persona.id) {
      setActiveId(null)
      saveSettings({ activePersonaId: undefined }).catch(() => {})
    }
    setShowDelete(false)
    onDeleted?.()
  }

  const isActive = activeId === persona.id

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="z-10 border-b border-border bg-surface px-6 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {persona.avatarPath ? (
              <img src={convertFileSrc ? convertFileSrc(persona.avatarPath) : persona.avatarPath}
                className="h-10 w-10 shrink-0 rounded-xl object-cover" alt="" />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent text-lg font-medium">
                {persona.name.charAt(0)}
              </div>
            )}
            <div>
              <h2 className="text-[15px] font-medium text-text-heading leading-tight">{persona.name}</h2>
              {isActive && (
                <span className="text-[12px] text-green-600">Active</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={handleSave} title="Save"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-input hover:text-accent transition-colors">
              <Save size={16} strokeWidth={1.5} />
            </button>
            <button onClick={() => setShowDelete(true)} title="Delete"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-red-50 hover:text-red-500 transition-colors">
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Avatar</span>
          <div className="flex items-center gap-3">
            {persona.avatarPath ? (
              <img src={convertFileSrc ? convertFileSrc(persona.avatarPath) : persona.avatarPath}
                className="h-16 w-16 rounded-xl object-cover border border-border" alt="" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-accent/10 text-accent text-lg font-medium border border-border">
                {persona.name.charAt(0)}
              </div>
            )}
            <button
              onClick={async () => {
                if (!dialogOpen) return
                const path = await dialogOpen({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
                if (path) update({ avatarPath: path })
              }}
              className="flex items-center gap-1 rounded-lg border border-border bg-input px-3 py-1.5 text-[13px] text-text hover:bg-surface transition-colors"
            >
              <Image size={14} /> Change
            </button>
          </div>
        </label>

        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Name</span>
          <input value={persona.name} onChange={(e) => update({ name: e.target.value })}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-text outline-none focus:border-accent/50" />
        </label>

        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Description</span>
          <textarea value={persona.description} onChange={(e) => update({ description: e.target.value })}
            rows={6}
            placeholder="Describe your persona — this is sent to the AI to help it understand who you are."
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-text placeholder:text-text-muted outline-none focus:border-accent/50 resize-y" />
        </label>

        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Position</span>
          <select value={persona.position} onChange={(e) => update({ position: e.target.value })}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-text outline-none focus:border-accent/50">
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{p === 'in_prompt' ? 'In System Prompt' : 'Disabled'}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Linked World Book</span>
          <WorldBookComboBox
            selected={persona.linkedWorldBook}
            onSelect={(name) => update({ linkedWorldBook: name })}
          />
        </label>
      </div>

      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="rounded-xl bg-surface border border-border shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-medium text-text-heading">Delete Persona</h3>
            <p className="mt-2 text-[14px] text-text">Delete <strong>{persona.name}</strong>? This cannot be undone.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowDelete(false)} className="rounded-lg border border-border bg-input px-4 py-2 text-[13px] text-text hover:bg-surface transition-colors">Cancel</button>
              <button onClick={handleDelete} className="rounded-lg bg-red-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
