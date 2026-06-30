import { useState, useEffect } from 'react'
import { X, Plus } from 'lucide-react'
import { listPersonas, createPersonaId, savePersona, type PersonaIndexEntry } from '../../lib/personas'
import { loadSettings, saveSettings } from '../../lib/settings'

type Props = {
  onClose: () => void
  onSelect: (id: string) => void
  selectedItemId: string | null
  refreshTrigger?: number
}

export function PersonaList({ onClose, onSelect, selectedItemId, refreshTrigger }: Props) {
  const [personas, setPersonas] = useState<PersonaIndexEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    listPersonas()
      .then(setPersonas)
      .catch(() => {})
    loadSettings()
      .then((s) => setActiveId(s.activePersonaId ?? null))
      .catch(() => {})
  }, [refreshTrigger])

  const addPersona = async () => {
    const id = createPersonaId()
    const now = Date.now()
    await savePersona({
      id,
      name: 'New Persona',
      description: '',
      avatarPath: null,
      position: 'in_prompt',
      linkedWorldBook: null,
      createdAt: now,
      updatedAt: now,
    }).catch(() => {})
    onSelect(id)
  }

  const toggleActive = (id: string) => {
    const next = activeId === id ? null : id
    setActiveId(next)
    saveSettings({ activePersonaId: next ?? undefined }).catch(() => {})
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text">
          Personas
        </h2>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-text hover:bg-border hover:text-text-heading"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto py-1">
        {personas.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-text-muted">No personas yet.</p>
        ) : (
          personas.map((p) => (
            <div
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`cursor-pointer px-4 py-2 transition-colors ${
                selectedItemId === p.id
                  ? 'bg-surface text-text-heading'
                  : 'text-text hover:bg-surface'
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleActive(p.id) }}
                  className={`inline-block h-2.5 w-2.5 rounded-full border shrink-0 ${
                    activeId === p.id
                      ? 'bg-green-500 border-green-500'
                      : 'border-text-muted'
                  }`}
                />
                <span className="text-[13px] truncate flex-1">{p.name}</span>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-border p-2">
        <button onClick={addPersona}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border py-2 text-[13px] text-text-muted hover:bg-surface hover:text-text transition-colors">
          <Plus size={14} /> New Persona
        </button>
      </div>
    </aside>
  )
}
