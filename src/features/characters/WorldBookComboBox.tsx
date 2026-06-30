import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Search, Check } from 'lucide-react'
import { listWorldBooks } from '../../lib/worldbooks'

type Props = {
  selected: string | null
  onSelect: (name: string | null) => void
}

export function WorldBookComboBox({ selected, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [books, setBooks] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listWorldBooks()
      .then(setBooks)
      .catch(() => setBooks(['The Kingdom of Aldoria', 'Magic System: Arcanum', 'The Dragon Wars']))
  }, [])

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      setSearch('')
    }
  }, [open])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = books.filter((b) =>
    b.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-text outline-none hover:border-accent/50 transition-colors"
      >
        <span className={selected ? 'text-text' : 'text-text-muted'}>
          {selected || '— None —'}
        </span>
        <ChevronDown size={14} className="text-text-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-border bg-surface shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={14} className="text-text-muted shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
              placeholder="Search world books..."
              className="flex-1 bg-transparent text-[14px] text-text placeholder:text-text-muted outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.map((name) => (
              <button
                key={name}
                onClick={() => { onSelect(name); setOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-[14px] text-text hover:bg-input transition-colors text-left"
              >
                {name === selected ? (
                  <Check size={14} className="text-accent shrink-0" />
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <span>{name}</span>
              </button>
            ))}
            {search && filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-[13px] text-text-muted">No world books found</p>
            )}
            <div className="border-t border-border mt-1 pt-1">
              <button
                onClick={() => { onSelect(null); setOpen(false) }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-[14px] hover:bg-input transition-colors text-left ${
                  !selected ? 'text-accent' : 'text-text-muted'
                }`}
              >
                {!selected ? (
                  <Check size={14} className="text-accent shrink-0" />
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <span>— None —</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
