import { X } from 'lucide-react'
import type { InspectorEntry } from '../../lib/inspector'

type Props = {
  entries: InspectorEntry[]
  selectedId: string | null
  onClose: () => void
  onSelect: (id: string) => void
}

export function InspectorList({ entries, selectedId, onClose, onSelect }: Props) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text">
          Inspector
        </h2>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-text hover:bg-border hover:text-text-heading"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto py-1">
        {entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-text-muted">
            No requests yet. Send a message to see context info.
          </p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              onClick={() => onSelect(entry.id)}
              className={`cursor-pointer px-4 py-2.5 transition-colors ${
                selectedId === entry.id
                  ? 'bg-surface text-text-heading'
                  : 'text-text hover:bg-surface'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                  entry.worldInfoActivated > 0 ? 'bg-green-500' : 'bg-text-muted'
                }`} />
                <span className="text-[13px] truncate flex-1">
                  {entry.characterName ?? 'No Character'}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted">
                <span>{formatTime(entry.timestamp)}</span>
                <span>·</span>
                <span>{entry.messageCount} msgs</span>
                {entry.worldInfoActivated > 0 && (
                  <>
                    <span>·</span>
                    <span>{entry.worldInfoActivated} WI</span>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
