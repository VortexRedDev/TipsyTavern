import { MessageSquare, Users, BookOpen, Settings, Terminal, User } from 'lucide-react'
import type { Panel } from '../types'

const topPanels = [
  { id: 'chat' as const, label: 'Chat', Icon: MessageSquare },
  { id: 'characters' as const, label: 'Characters', Icon: Users },
  { id: 'worldbook' as const, label: 'World Book', Icon: BookOpen },
  { id: 'personas' as const, label: 'Personas', Icon: User },
]
const bottomPanels = [
  { id: 'inspector' as const, label: 'Inspector', Icon: Terminal },
  { id: 'settings' as const, label: 'Settings', Icon: Settings },
]

export default function ActivityBar({
  active,
  onSelect,
}: {
  active: Panel
  onSelect: (p: Panel) => void
}) {
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-input py-3">
      {topPanels.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onSelect(active === id ? null : id)}
          title={label}
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
            active === id
              ? 'bg-surface text-accent shadow-sm ring-1 ring-border'
              : 'text-text hover:bg-surface hover:text-text-heading'
          }`}
        >
          <Icon size={20} strokeWidth={1.5} />
        </button>
      ))}
      <div className="mt-auto" />
      {bottomPanels.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onSelect(active === id ? null : id)}
          title={label}
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
            active === id
              ? 'bg-surface text-accent shadow-sm ring-1 ring-border'
              : 'text-text hover:bg-surface hover:text-text-heading'
          }`}
        >
          <Icon size={20} strokeWidth={1.5} />
        </button>
      ))}
    </nav>
  )
}
