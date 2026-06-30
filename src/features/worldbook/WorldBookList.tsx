import { useState, useEffect } from 'react'
import { X, Search, Plus, Pencil, Check } from 'lucide-react'
import { listWorldBooks, createWorldBook, renameWorldBook } from '../../lib/worldbooks'

type Props = {
  onClose: () => void
  onSelect: (id: string) => void
  selectedItemId: string | null
  refreshTrigger?: number
}

const MOCK_BOOKS = ['The Kingdom of Aldoria', 'Magic System: Arcanum', 'The Dragon Wars']

export function WorldBookList({ onClose, onSelect, selectedItemId, refreshTrigger }: Props) {
  const [books, setBooks] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newName, setNewName] = useState('')

  const refresh = () => {
    setLoading(true)
    listWorldBooks()
      .then((data) => setBooks(data.length ? data : MOCK_BOOKS))
      .catch(() => setBooks(MOCK_BOOKS))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [refreshTrigger])

  const handleNew = async () => {
    const name = newName.trim()
    if (!name || books.includes(name)) return
    await createWorldBook(name).catch(() => {})
    setShowNewDialog(false)
    setNewName('')
    refresh()
    onSelect(name)
  }

  const handleRename = async (oldName: string) => {
    const name = editValue.trim()
    if (!name || name === oldName || books.includes(name)) {
      setEditingName(null)
      return
    }
    await renameWorldBook(oldName, name).catch(() => {})
    setEditingName(null)
    refresh()
    if (selectedItemId === oldName) onSelect(name)
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text">
          World Book
        </h2>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-text hover:bg-border hover:text-text-heading"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>
      <div className="flex items-center gap-0.5 border-b border-border px-2 py-1.5">
        <button className="flex h-7 w-7 items-center justify-center rounded text-text-muted" title="Search">
          <Search size={14} strokeWidth={1.5} />
        </button>
        <div className="flex-1" />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
          </div>
        ) : (
          books.map((name) => (
            <div
              key={name}
              className="group flex items-center"
            >
              {editingName === name ? (
                <div className="flex items-center gap-1 px-2 py-1 flex-1">
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(name)
                      if (e.key === 'Escape') setEditingName(null)
                    }}
                    onBlur={() => handleRename(name)}
                    className="flex-1 rounded border border-accent bg-surface px-2 py-1 text-[13px] text-text outline-none"
                    autoFocus
                  />
                  <button onClick={() => handleRename(name)} className="flex h-5 w-5 items-center justify-center rounded text-green-600 hover:bg-green-50">
                    <Check size={12} />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => onSelect(name)}
                  className={`flex-1 cursor-pointer flex items-center justify-between px-4 py-2 text-[14px] transition-colors ${
                    selectedItemId === name
                      ? 'bg-surface text-text-heading'
                      : 'text-text hover:bg-surface'
                  }`}
                >
                  <span className="truncate">{name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingName(name); setEditValue(name) }}
                    className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:text-text"
                    title="Rename"
                  >
                    <Pencil size={11} />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <div className="border-t border-border p-2">
        <button onClick={() => { setShowNewDialog(true); setNewName('') }}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border py-2 text-[13px] text-text-muted hover:bg-surface hover:text-text transition-colors">
          <Plus size={14} /> New World Book
        </button>
      </div>

      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="rounded-xl bg-surface border border-border shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-medium text-text-heading">New World Book</h3>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNew(); if (e.key === 'Escape') setShowNewDialog(false) }}
              placeholder="Book name..."
              autoFocus
              className="mt-3 w-full rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-text placeholder:text-text-muted outline-none focus:border-accent/50"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowNewDialog(false)} className="rounded-lg border border-border bg-input px-4 py-2 text-[13px] text-text hover:bg-surface transition-colors">Cancel</button>
              <button onClick={handleNew} disabled={!newName.trim()} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity">Create</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
