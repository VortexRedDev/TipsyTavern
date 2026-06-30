import type { InspectorEntry } from '../../lib/inspector'

type Props = {
  entry: InspectorEntry | null
}

export function InspectorWorkspace({ entry }: Props) {
  if (!entry) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-muted text-[14px]">
        Select a request to inspect.
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="z-10 border-b border-border bg-surface px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <span className={`inline-block h-3 w-3 rounded-full shrink-0 ${
            entry.worldInfoActivated > 0 ? 'bg-green-500' : 'bg-text-muted'
          }`} />
          <div>
            <h2 className="text-[15px] font-medium text-text-heading leading-tight">
              {entry.characterName ?? 'No Character'}
            </h2>
            <p className="text-[12px] text-text-muted">
              {entry.providerId} · {entry.modelId}
              {entry.worldInfoActivated > 0 && (
                <span className="ml-2 text-green-600">
                  {entry.worldInfoActivated} world info activated ({entry.worldInfoTokensUsed} tokens)
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {entry.systemPrompt && (
          <Section title="System Prompt" defaultOpen>
            <pre className="whitespace-pre-wrap text-[13px] text-text leading-relaxed font-sans">
              {entry.systemPrompt}
            </pre>
          </Section>
        )}

        <Section title={`Messages (${entry.messages.length})`} defaultOpen>
          <div className="space-y-3">
            {entry.messages.map((msg, i) => (
              <div key={i} className={`rounded-lg border px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-accent/5 border-accent/20'
                  : msg.role === 'system'
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-input border-border'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[11px] font-semibold uppercase ${
                    msg.role === 'user' ? 'text-accent' :
                    msg.role === 'system' ? 'text-amber-600' : 'text-text-muted'
                  }`}>
                    {msg.role}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    ~{Math.round(msg.content.length / 3)} tokens
                  </span>
                </div>
                <pre className="whitespace-pre-wrap text-[13px] text-text leading-relaxed font-sans">
                  {msg.content}
                </pre>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, defaultOpen, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open] = [true]
  return (
    <details open={defaultOpen ?? open}>
      <summary className="cursor-pointer text-[13px] font-semibold text-text-heading mb-2 hover:text-accent transition-colors">
        {title}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  )
}
