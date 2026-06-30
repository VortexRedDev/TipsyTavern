import { useState, useEffect } from 'react'
import { X, Search, Plus } from 'lucide-react'
import type { ChatIndexEntry } from '../../lib/chats'
import { listChats } from '../../lib/chats'

type Props = {
  onClose: () => void
  onSelect: (id: string) => void
  selectedItemId: string | null
  refreshTrigger?: number
}

const MOCK_CHATS: ChatIndexEntry[] = [
  { id: '1', title: 'Getting Started', character_id: '', created_at: 0, updated_at: 0 },
  { id: '2', title: 'Character Creation Tips', character_id: '', created_at: 0, updated_at: 0 },
  { id: '3', title: 'World Building Ideas', character_id: '', created_at: 0, updated_at: 0 },
]

export function ChatList({ onClose, onSelect, selectedItemId, refreshTrigger }: Props) {
  const [chats, setChats] = useState<ChatIndexEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    setLoading(true)
    listChats()
      .then((data) => setChats(data))
      .catch(() => setChats(MOCK_CHATS))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [refreshTrigger])

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text">
          Conversations
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
        <div className="flex-1" />
        <button className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface hover:text-text" title="New Chat">
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
          </div>
        ) : (
          chats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => onSelect(chat.id)}
              className={`cursor-pointer px-4 py-2 text-[14px] transition-colors ${
                selectedItemId === chat.id
                  ? 'bg-surface text-text-heading'
                  : 'text-text hover:bg-surface'
              }`}
            >
              {chat.title}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
