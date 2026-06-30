import { Minus, Square, X } from 'lucide-react'

async function getWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

export function TitleBar() {
  const minimize = async () => {
    try { (await getWindow()).minimize() } catch {}
  }

  const toggleMaximize = async () => {
    try { await (await getWindow()).toggleMaximize() } catch {}
  }

  const close = async () => {
    try { (await getWindow()).close() } catch {}
  }

  return (
    <div
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center justify-between bg-input border-b border-border select-none"
    >
      <div className="pl-3 text-[13px] font-medium text-text-heading">
        TipsyTavern
      </div>
      <div className="flex h-full">
        <button
          onClick={minimize}
          className="flex h-full w-11 items-center justify-center text-text-muted hover:bg-border hover:text-text transition-colors"
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          onClick={toggleMaximize}
          className="flex h-full w-11 items-center justify-center text-text-muted hover:bg-border hover:text-text transition-colors"
        >
          <Square size={12} strokeWidth={1.5} />
        </button>
        <button
          onClick={close}
          className="flex h-full w-11 items-center justify-center text-text-muted hover:bg-red-500 hover:text-white transition-colors"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}
