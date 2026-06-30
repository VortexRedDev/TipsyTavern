import { X } from 'lucide-react'

const mockCategories = [
  { id: '1', name: 'Model Providers' },
  { id: '2', name: 'World Book' },
  { id: '3', name: 'Theme' },
  { id: '4', name: 'About' },
]

type Props = {
  onClose: () => void
  onSelect: (id: string) => void
  selectedItemId: string | null
  refreshTrigger?: number
}

export function SettingsList({ onClose, onSelect, selectedItemId }: Props) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text">
          Settings
        </h2>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-text hover:bg-border hover:text-text-heading"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto py-1">
        {mockCategories.map((item) => (
          <div
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`cursor-pointer px-4 py-2 text-[14px] transition-colors ${
              selectedItemId === item.id
                ? 'bg-surface text-text-heading'
                : 'text-text hover:bg-surface'
            }`}
          >
            {item.name}
          </div>
        ))}
      </div>
    </aside>
  )
}
