import { useState, useEffect } from 'react'
import { X, Search, Plus, Download, MessageCircle } from 'lucide-react'
import type { CharacterIndexEntry } from '../../types'
import { listCharacters, importCharacter, openFileDialog } from '../../lib/characters'

type Props = {
  onClose: () => void
  onSelect: (id: string) => void
  selectedItemId: string | null
  refreshTrigger: number
  onStartChat?: (characterId: string, characterName: string) => void
}

const MOCK_CHARACTERS: CharacterIndexEntry[] = [
  { id: '1', name: 'Lyra the Bard', kind: 'ai', created_at: 0, updated_at: 0 },
  { id: '2', name: 'Thorne the Knight', kind: 'ai', created_at: 0, updated_at: 0 },
  { id: '3', name: 'Elara the Mage', kind: 'ai', created_at: 0, updated_at: 0 },
]

export function CharacterList({ onClose, onSelect, selectedItemId, refreshTrigger, onStartChat }: Props) {
  const [characters, setCharacters] = useState<CharacterIndexEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    setLoading(true)
    listCharacters()
      .then((data) => setCharacters(data.length ? data : MOCK_CHARACTERS))
      .catch(() => setCharacters(MOCK_CHARACTERS))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [refreshTrigger])

  const handleImport = async () => {
    const path = await openFileDialog()
    if (!path) return
    try {
      await importCharacter(path)
      refresh()
    } catch {}
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text">
          Characters
        </h2>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-text hover:bg-border hover:text-text-heading"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>
      <div className="flex items-center gap-0.5 border-b border-border px-2 py-1.5">
        <button className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface hover:text-text" title="Search">
          <Search size={14} strokeWidth={1.5} />
        </button>
        <button
          onClick={handleImport}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface hover:text-text"
          title="Import"
        >
          <Download size={14} strokeWidth={1.5} />
        </button>
        <div className="flex-1" />
        <button className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface hover:text-text" title="Create">
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
          </div>
        ) : (
          characters.map((char) => (
            <div
              key={char.id}
              className={`flex items-center group cursor-pointer px-4 py-2 text-[14px] transition-colors ${
                selectedItemId === char.id
                  ? 'bg-surface text-text-heading'
                  : 'text-text hover:bg-surface'
              }`}
            >
              <span className="flex-1 truncate" onClick={() => onSelect(char.id)}>{char.name}</span>
              {onStartChat && (
                <button
                  onClick={(e) => { e.stopPropagation(); onStartChat(char.id, char.name) }}
                  title="Start Chat"
                  className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted opacity-0 group-hover:opacity-100 hover:bg-accent/10 hover:text-accent transition-all"
                >
                  <MessageCircle size={14} strokeWidth={1.5} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
