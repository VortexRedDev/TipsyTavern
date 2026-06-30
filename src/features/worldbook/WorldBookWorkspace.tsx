import { useState, useEffect, useCallback } from 'react'
import { Plus, ChevronDown, ChevronRight, Trash2, Copy, ArrowLeftRight } from 'lucide-react'
import { loadWorldBook, saveWorldBook, listWorldBooks, deleteWorldBook, type WorldBookEntry } from '../../lib/worldbooks'

type Props = { selectedItemId: string; onDeleted?: () => void }

const POSITIONS = ['before_char', 'after_char', 'in_char', 'before_user', 'after_user']


export function WorldBookWorkspace({ selectedItemId, onDeleted }: Props) {
  const [entries, setEntries] = useState<WorldBookEntry[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [allBooks, setAllBooks] = useState<string[]>([])
  const [copyTarget, setCopyTarget] = useState<{ entryId: number; bookName: string } | null>(null)
  const [moveTarget, setMoveTarget] = useState<{ entryId: number; bookName: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const [bookDeleteTarget, setBookDeleteTarget] = useState(false)

  const bookName = selectedItemId

  const refresh = useCallback(() => {
    setLoading(true)
    loadWorldBook(bookName)
      .then((data) => setEntries(data))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
    listWorldBooks()
      .then(setAllBooks)
      .catch(() => setAllBooks([]))
  }, [bookName])

  useEffect(() => { setExpandedId(null); refresh() }, [refresh])

  const persist = (updated: WorldBookEntry[]) => {
    setEntries(updated)
    saveWorldBook(bookName, updated).catch(() => {})
  }

  const updateEntry = (id: number, patch: Partial<WorldBookEntry>) => {
    const updated = entries.map((e) => e.id === id ? { ...e, ...patch } : e)
    persist(updated)
  }

  const addEntry = () => {
    const maxId = entries.reduce((max, e) => Math.max(max, e.id), 0)
    const entry: WorldBookEntry = {
      id: maxId + 1, keys: [], secondaryKeys: [], comment: 'New Entry',
      content: '', constant: false, selective: false, selectiveLogic: 0,
      insertionOrder: 100, enabled: true, position: 'before_char',
    }
    persist([...entries, entry])
    setExpandedId(entry.id)
  }

  const confirmDelete = () => {
    if (deleteTarget === null) return
    const updated = entries.filter((e) => e.id !== deleteTarget)
    persist(updated)
    if (expandedId === deleteTarget) setExpandedId(null)
    setDeleteTarget(null)
  }

  const confirmCopy = async (targetBook: string) => {
    if (!copyTarget) return
    const entry = entries.find((e) => e.id === copyTarget.entryId)
    if (!entry) return
    let targetEntries: WorldBookEntry[] = []
    try { targetEntries = await loadWorldBook(targetBook) } catch {}
    const maxId = targetEntries.reduce((max, e) => Math.max(max, e.id), 0)
    const clone = { ...entry, id: maxId + 1 }
    await saveWorldBook(targetBook, [...targetEntries, clone]).catch(() => {})
    setCopyTarget(null)
    refresh()
  }

  const confirmMove = async (targetBook: string) => {
    if (!moveTarget) return
    const entry = entries.find((e) => e.id === moveTarget.entryId)
    if (!entry) return
    let targetEntries: WorldBookEntry[] = []
    try { targetEntries = await loadWorldBook(targetBook) } catch {}
    const maxId = targetEntries.reduce((max, e) => Math.max(max, e.id), 0)
    const clone = { ...entry, id: maxId + 1 }
    await saveWorldBook(targetBook, [...targetEntries, clone]).catch(() => {})
    const updated = entries.filter((e) => e.id !== moveTarget.entryId)
    persist(updated)
    if (expandedId === moveTarget.entryId) setExpandedId(null)
    setMoveTarget(null)
  }

  const confirmBookDelete = async () => {
    await deleteWorldBook(bookName).catch(() => {})
    setBookDeleteTarget(false)
    onDeleted?.()
  }

  const addKey = (entryId: number, key: string, field: 'keys' | 'secondaryKeys') => {
    const t = key.trim().toLowerCase()
    if (!t) return
    const entry = entries.find((e) => e.id === entryId)
    if (!entry || entry[field].includes(t)) return
    updateEntry(entryId, { [field]: [...entry[field], t] })
  }

  const removeKey = (entryId: number, key: string, field: 'keys' | 'secondaryKeys') => {
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) return
    updateEntry(entryId, { [field]: entry[field].filter((k) => k !== key) })
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="z-10 border-b border-border bg-surface px-6 py-3 shrink-0 flex items-center justify-between">
        <h2 className="text-[15px] font-medium text-text-heading">{bookName}</h2>
        <button onClick={() => setBookDeleteTarget(true)} title="Delete world book"
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:text-red-500 hover:bg-red-50">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-center text-text-muted text-[14px] py-12">No entries yet.</p>
        ) : (
          entries.map((entry) => {
            const isExpanded = expandedId === entry.id
            return (
              <div key={entry.id} className="rounded-lg border border-border bg-surface">
                {/* Collapsed row */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer ${
                    isExpanded ? 'border-b border-border' : ''
                  } ${!entry.enabled ? 'opacity-50' : ''}`}
                >
                  <button className="shrink-0 text-text-muted">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>

                  {/* Enabled toggle */}
                  <button
                    onClick={(e) => { e.stopPropagation(); updateEntry(entry.id, { enabled: !entry.enabled }) }}
                    className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${
                      entry.enabled ? 'bg-accent' : 'bg-border'
                    }`}
                  >
                    <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform ${
                      entry.enabled ? 'left-[18px]' : 'left-0.5'
                    }`} />
                  </button>

                  <span className="flex-1 truncate flex items-center gap-1.5 text-[14px] text-text">
                    <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${entry.constant ? 'bg-blue-500' : 'bg-green-500'}`} />
                    {entry.comment || `#${entry.id}`}
                  </span>

                  {/* Activation mode dropdown */}
                  <select
                    value={entry.constant ? 'always' : 'keywords'}
                    onChange={(e) => {
                      e.stopPropagation()
                      const isConstant = e.target.value === 'always'
                      updateEntry(entry.id, { constant: isConstant, selective: false })
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border border-border bg-input px-2 py-0.5 text-[12px] text-text outline-none shrink-0"
                  >
                    <option value="always">Always</option>
                    <option value="keywords">By Keywords</option>
                  </select>

                  {/* Action icons */}
                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setMoveTarget({ entryId: entry.id, bookName: '' })} title="Move to..."
                      className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-text hover:bg-border">
                      <ArrowLeftRight size={13} />
                    </button>
                    <button onClick={() => setCopyTarget({ entryId: entry.id, bookName: bookName })} title="Copy to..."
                      className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-text hover:bg-border">
                      <Copy size={13} />
                    </button>
                    <button onClick={() => setDeleteTarget(entry.id)} title="Delete"
                      className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-red-500 hover:bg-red-50">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Expanded form */}
                {isExpanded && (
                  <div className="px-4 py-3 space-y-3">
                    <Field label="Keys">
                      <TagList
                        tags={entry.keys}
                        onAdd={(k) => addKey(entry.id, k, 'keys')}
                        onRemove={(k) => removeKey(entry.id, k, 'keys')}
                      />
                    </Field>

                    {!entry.constant && (
                      <label className="flex items-center gap-1.5 text-[13px] text-text ml-1">
                        <input type="checkbox" checked={entry.selective} onChange={(e) => updateEntry(entry.id, { selective: e.target.checked })}
                          className="rounded" />
                        Selective
                      </label>
                    )}
                    <Field label="Secondary Keys">
                      <TagList
                        tags={entry.secondaryKeys}
                        onAdd={(k) => addKey(entry.id, k, 'secondaryKeys')}
                        onRemove={(k) => removeKey(entry.id, k, 'secondaryKeys')}
                      />
                    </Field>

                    <Field label="Comment">
                      <input value={entry.comment} onChange={(e) => updateEntry(entry.id, { comment: e.target.value })}
                        className="w-full rounded-lg border border-border bg-input px-3 py-1.5 text-[14px] text-text outline-none focus:border-accent/50" />
                    </Field>

                    <Field label="Content">
                      <textarea value={entry.content} onChange={(e) => updateEntry(entry.id, { content: e.target.value })}
                        rows={4}
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-text outline-none focus:border-accent/50 resize-y" />
                    </Field>

                    <div className="flex flex-wrap items-center gap-4 text-[13px] text-text">
                      <label className="flex items-center gap-1.5">
                        Position
                        <select value={entry.position} onChange={(e) => updateEntry(entry.id, { position: e.target.value })}
                          className="rounded border border-border bg-input px-2 py-0.5 text-[13px] outline-none">
                          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5">
                        Order
                        <input type="number" value={entry.insertionOrder} onChange={(e) => updateEntry(entry.id, { insertionOrder: Number(e.target.value) })}
                          className="w-16 rounded border border-border bg-input px-2 py-0.5 text-[13px] outline-none" />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}

        <button onClick={addEntry}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border py-2.5 text-[13px] text-text-muted hover:bg-input hover:text-text transition-colors">
          <Plus size={14} /> New Entry
        </button>
      </div>

      {/* Delete confirmation */}
      {deleteTarget !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="rounded-xl bg-surface border border-border shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-medium text-text-heading">Delete Entry</h3>
            <p className="mt-2 text-[14px] text-text">Delete this world book entry? This cannot be undone.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-border bg-input px-4 py-2 text-[13px] text-text hover:bg-surface transition-colors">Cancel</button>
              <button onClick={confirmDelete}
                className="rounded-lg bg-red-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Copy / Move dialog */}
      {(copyTarget || moveTarget) && (
        <TransferDialog
          title={copyTarget ? 'Copy Entry To' : 'Move Entry To'}
          books={allBooks}
          defaultBook={copyTarget?.bookName ?? ''}
          onConfirm={(targetBook) => {
            if (copyTarget) confirmCopy(targetBook)
            if (moveTarget) confirmMove(targetBook)
          }}
          onCancel={() => { setCopyTarget(null); setMoveTarget(null) }}
        />
      )}

      {/* Book delete confirmation */}
      {bookDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="rounded-xl bg-surface border border-border shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-medium text-text-heading">Delete World Book</h3>
            <p className="mt-2 text-[14px] text-text">
              Are you sure you want to delete <strong>{bookName}</strong> and all its entries? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setBookDeleteTarget(false)}
                className="rounded-lg border border-border bg-input px-4 py-2 text-[13px] text-text hover:bg-surface transition-colors">Cancel</button>
              <button onClick={confirmBookDelete}
                className="rounded-lg bg-red-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TransferDialog({ title, books, defaultBook, onConfirm, onCancel }: {
  title: string; books: string[]; defaultBook: string; onConfirm: (book: string) => void; onCancel: () => void
}) {
  const [selected, setSelected] = useState(defaultBook || books[0] || '')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
      <div className="rounded-xl bg-surface border border-border shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-[15px] font-medium text-text-heading">{title}</h3>
        <div className="mt-3">
          <label className="text-[13px] text-text-muted">Target World Book</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-text outline-none">
            {books.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-lg border border-border bg-input px-4 py-2 text-[13px] text-text hover:bg-surface transition-colors">Cancel</button>
          <button onClick={() => onConfirm(selected)}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 transition-opacity">Confirm</button>
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

function TagList({ tags, onAdd, onRemove }: { tags: string[]; onAdd: (k: string) => void; onRemove: (k: string) => void }) {
  const [input, setInput] = useState('')
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-0.5 rounded-md bg-accent/5 border border-accent/20 px-1.5 py-0.5 text-[12px] text-accent">
            {t}
            <button onClick={() => onRemove(t)} className="hover:text-text">&times;</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(input); setInput('') } }}
          placeholder="Add key..." className="flex-1 rounded border border-border bg-input px-2 py-1 text-[13px] outline-none focus:border-accent/50" />
        <button onClick={() => { onAdd(input); setInput('') }}
          className="rounded border border-border bg-input px-2 py-1 text-[12px] text-text-muted hover:text-text">Add</button>
      </div>
    </div>
  )
}
