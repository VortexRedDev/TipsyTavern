import { useState, useEffect } from 'react'
import { Save, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import type { CharacterData } from '../../types'
import { loadCharacter, saveCharacter, deleteCharacter, getCharacterWorldBooks, setCharacterWorldBook } from '../../lib/characters'
import { WorldBookComboBox } from './WorldBookComboBox'

const MOCK_CHARACTERS: Record<string, CharacterData> = {
  '1': {
    id: '1', name: 'Lyra the Bard', kind: 'ai', icon: 'music_note',
    description: 'A wandering minstrel from the Silver Coast with a voice that can charm dragons and a wit sharper than any blade.',
    personality: '', scenario: '',
    firstMessage: "Hey there! I'm Lyra, a wandering bard from the Silver Coast. What tales shall we spin today?",
    alternateGreetings: [
      "Another traveler! Pull up a chair — I was just about to sing the Ballad of the Fallen Star.",
      "Ah, a new face! Care to hear a tale, or perhaps share one of your own?",
    ], exampleMessages: '', systemPrompt: '',
    tags: ['fantasy', 'bard', 'adventure', 'music'],
    creator: 'TipsyTavern', version: '1.0',
    avatarPath: null, linkedWorldBook: 'The Kingdom of Aldoria',
    createdAt: 0, updatedAt: 0,
  },
  '2': {
    id: '2', name: 'Thorne the Knight', kind: 'ai', icon: 'shield',
    description: 'A stoic knight of the Crimson Order, sworn to protect the realm.',
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
    description: 'A brilliant but eccentric archmage who speaks in riddles.',
    personality: '', scenario: '',
    firstMessage: 'Ah! Perfect timing. Tell me — do you believe that reality is a tapestry or a river?',
    alternateGreetings: [], exampleMessages: '', systemPrompt: '',
    tags: ['fantasy', 'mage', 'magic'],
    creator: '', version: '',
    avatarPath: null, linkedWorldBook: 'Magic System: Arcanum',
    createdAt: 0, updatedAt: 0,
  },
}

let convertFileSrc: ((path: string) => string) | null = null
import('@tauri-apps/api/core').then(m => { convertFileSrc = m.convertFileSrc }).catch(() => {})

type Props = { selectedItemId: string; onDeleted?: () => void }

export function CharacterWorkspace({ selectedItemId, onDeleted }: Props) {
  const [character, setCharacter] = useState<CharacterData | null>(null)
  const [imgFailed, setImgFailed] = useState(false)
  const [showGreetings, setShowGreetings] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [worldBookBinding, setWorldBookBinding] = useState<string | null>(null)
  useEffect(() => {
    setImgFailed(false)
    loadCharacter(selectedItemId)
      .then((data) => setCharacter(data ?? null))
      .catch(() => { setCharacter(MOCK_CHARACTERS[selectedItemId] ?? null) })
    getCharacterWorldBooks(selectedItemId)
      .then((b) => setWorldBookBinding(b.primary))
      .catch(() => setWorldBookBinding(null))
  }, [selectedItemId])

  if (!character) return <div className="flex flex-1 items-center justify-center text-text-muted text-[14px]">Character not found.</div>

  const update = (patch: Partial<CharacterData>) => setCharacter((prev) => prev ? { ...prev, ...patch } : prev)

  const handleSave = () => {
    if (!character) return
    saveCharacter({ ...character, updatedAt: Date.now() }).catch(() => {})
  }

  const handleDelete = () => {
    setShowDeleteConfirm(true)
  }

  const confirmDelete = async () => {
    if (!character) return
    try { await deleteCharacter(character.id) } catch {}
    setShowDeleteConfirm(false)
    onDeleted?.()
  }

  const avatarSrc = !imgFailed && character.avatarPath
    ? (convertFileSrc ? convertFileSrc(character.avatarPath) : character.avatarPath)
    : null

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header */}
      <div className="z-10 border-b border-border bg-surface px-6 py-3 shrink-0">
        <div className="flex items-center gap-4">
          {avatarSrc ? (
            <img src={avatarSrc} alt={character.name} onError={() => setImgFailed(true)} className="h-10 w-10 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent text-lg font-medium">{character.name.charAt(0)}</div>
          )}
          <div className="min-w-0 flex-1">
            <input value={character.name} onChange={(e) => update({ name: e.target.value })}
              className="w-full bg-transparent text-[18px] font-medium text-text-heading outline-none border-b border-transparent hover:border-border focus:border-accent transition-colors" />
            <div className="mt-1 flex flex-wrap gap-1 min-h-[20px]">
              {character.tags.map((tag) => (
                <span key={tag} className="inline-block rounded-md bg-accent/5 border border-accent/20 px-1.5 py-px text-[11px] text-accent">{tag}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={handleSave} title="Save"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-input hover:text-accent transition-colors">
              <Save size={16} strokeWidth={1.5} />
            </button>
            <button onClick={handleDelete} title="Delete"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-red-50 hover:text-red-500 transition-colors">
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-5 p-6">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Linked World Book</span>
            <WorldBookComboBox
              selected={worldBookBinding}
              onSelect={(name) => {
                setWorldBookBinding(name)
                setCharacterWorldBook(character.id, name).catch(() => {})
              }}
            />
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Description</span>
            <textarea value={character.description} onChange={(e) => update({ description: e.target.value })}
              rows={8} className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-text placeholder:text-text-muted outline-none focus:border-accent/50 focus:bg-surface transition-colors resize-y" />
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">First Message</span>
            <textarea value={character.firstMessage} onChange={(e) => update({ firstMessage: e.target.value })}
              rows={8} className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-text placeholder:text-text-muted outline-none focus:border-accent/50 focus:bg-surface transition-colors resize-y" />
          </label>

          {/* Collapsible alternate greetings */}
          <div>
            <button
              onClick={() => setShowGreetings(!showGreetings)}
              className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted hover:text-text transition-colors"
            >
              {showGreetings ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Alternate Greetings ({character.alternateGreetings.length})
            </button>
            {showGreetings && (
              <div className="mt-3 space-y-3">
                {character.alternateGreetings.map((greeting, i) => (
                  <div key={i}>
                    <span className="block text-[11px] text-text-muted mb-1">#{i + 1}</span>
                    <textarea
                      value={greeting}
                      onChange={(e) => {
                        const next = [...character.alternateGreetings]
                        next[i] = e.target.value
                        update({ alternateGreetings: next })
                      }}
                      rows={3}
                      className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-text placeholder:text-text-muted outline-none focus:border-accent/50 focus:bg-surface transition-colors resize-y"
                    />
                  </div>
                ))}
                {character.alternateGreetings.length === 0 && (
                  <p className="text-[13px] text-text-muted">No alternate greetings defined.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="rounded-xl bg-surface border border-border shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-medium text-text-heading">Delete Character</h3>
            <p className="mt-2 text-[14px] text-text">
              Are you sure you want to delete <strong>{character.name}</strong>? This will remove the character card and any overlay edits. This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg border border-border bg-input px-4 py-2 text-[13px] text-text hover:bg-surface transition-colors">
                Cancel
              </button>
              <button onClick={confirmDelete}
                className="rounded-lg bg-red-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-600 transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
