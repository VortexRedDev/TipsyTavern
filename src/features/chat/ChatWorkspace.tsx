import { useState, useEffect, useRef } from 'react'
import { Bold, Italic, Quote, Send, Copy, Pencil, Trash2, Check, X, MessageSquarePlus, AlignJustify, MessageSquare } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { loadChat, saveChat, deleteChat, createChatId, type ChatData, type CharacterMessage } from '../../lib/chats'
import { loadSettings } from '../../lib/settings'
import { streamGenerate, getDefaultModel } from '../../lib/generate'
import { getActiveStream, subscribe, clearStream } from '../../lib/active-stream'
import { loadCharacter } from '../../lib/characters'
import { loadPersona } from '../../lib/personas'

let convertFileSrc: ((path: string) => string) | null = null
import('@tauri-apps/api/core').then(m => { convertFileSrc = m.convertFileSrc }).catch(() => {})

const MOCK_CHAT: ChatData = {
  id: '1', title: 'Getting Started', character_id: '1',
  created_at: 0, updated_at: 0,
  messages: [
    { role: 'assistant', content: "Hey there! I'm **Lyra**, a wandering bard from the Silver Coast. What tales shall we spin today?", swipes: [], current_swipe_index: 0 },
    { role: 'user', content: 'Tell me about the Silver Coast.', swipes: [], current_swipe_index: 0 },
    { role: 'assistant', content: 'Ah, the Silver Coast! Imagine cliffs that glow under moonlight, where sea-spray catches the stars and turns them into diamonds.', swipes: [], current_swipe_index: 0 },
  ],
}

type Props = {
  selectedItemId: string
  onDeleteChat?: () => void
  onNewChat?: (characterId: string) => void
}

export function ChatWorkspace({ selectedItemId, onDeleteChat, onNewChat }: Props) {
  const [chat, setChat] = useState<ChatData | null>(null)
  const [modelLabel, setModelLabel] = useState('No model selected')
  const [input, setInput] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showNewConfirm, setShowNewConfirm] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isFlatLayout, setIsFlatLayout] = useState(() => {
    try { return localStorage.getItem('chatFlatLayout') === '1' } catch { return false }
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<ChatData | null>(null)
  const [charAvatar, setCharAvatar] = useState<string | null>(null)
  const [userAvatar, setUserAvatar] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)

  // Keep ref in sync with state so callbacks can save to disk even if unmounted
  useEffect(() => { chatRef.current = chat }, [chat])

  useEffect(() => {
    loadChat(selectedItemId)
      .then((data) => {
        const loaded = data ?? (selectedItemId === '1' ? MOCK_CHAT : null)
        if (!loaded) { setChat(null); return }
        // Check if there's an active stream for this chat (panel was switched mid-stream)
        const active = getActiveStream(loaded.id)
        if (active && active.chatId === loaded.id && !active.done) {
          const msgs = [...active.baseMessages]
          msgs.push({
            id: active.streamingKey, role: 'assistant', content: active.streamingText,
            reasoning: active.streamingThinking || undefined,
            swipes: [], current_swipe_index: 0, timestamp: Date.now(),
          })
          setChat({ ...loaded, messages: msgs })
          setIsStreaming(true)
        } else {
          setChat(loaded)
        }
      })
      .catch(() => setChat(selectedItemId === '1' ? MOCK_CHAT : null))
  }, [selectedItemId])

  useEffect(() => {
    if (!chat?.character_id) return
    loadCharacter(chat.character_id).then((c) => {
      if (c?.avatarPath) setCharAvatar(convertFileSrc ? convertFileSrc(c.avatarPath) : c.avatarPath)
    }).catch(() => {})
    loadSettings().then((s) => {
      if (s.activePersonaId) {
        loadPersona(s.activePersonaId).then((p) => {
          if (p) {
            setUserName(p.name)
            if (p.avatarPath) setUserAvatar(convertFileSrc ? convertFileSrc(p.avatarPath) : p.avatarPath)
          }
        }).catch(() => {})
      }
    }).catch(() => {})
  }, [chat?.character_id, chat?.id])

  useEffect(() => {
    loadSettings().then((s) => {
      if (s.defaultChatModel) setModelLabel(`${s.defaultChatModel.providerName} · ${s.defaultChatModel.modelName}`)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'instant' })
  }, [chat?.messages])

  // Subscribe to stream store — finalizes state when stream completes
  useEffect(() => {
    return subscribe(() => {
      const active = getActiveStream(chatRef.current?.id ?? '')
      if (!active || active.chatId !== chatRef.current?.id) return
      if (active.done) {
        setIsStreaming(false)
        if (active.error) {
          setChat((prev) => {
            if (!prev) return prev
            const msgs = [...active.baseMessages]
            msgs.push({
              id: createChatId(), role: 'assistant', content: `⚠️ ${active.error}`,
              swipes: [], current_swipe_index: 0, timestamp: Date.now(),
            })
            const updated = { ...prev, messages: msgs, updated_at: Date.now() }
            saveChat(updated).catch(() => {})
            return updated
          })
        } else {
          // Stream finished normally — finalize the streaming message
          setChat((prev) => {
            if (!prev) return prev
            const msgs = [...active.baseMessages]
            msgs.push({
              id: createChatId(), role: 'assistant', content: active.streamingText,
              reasoning: active.streamingThinking || undefined,
              swipes: [], current_swipe_index: 0, timestamp: Date.now(),
            })
            const updated = { ...prev, messages: msgs, updated_at: Date.now() }
            saveChat(updated).catch(() => {})
            return updated
          })
        }
      } else {
        // Mid-stream update
        setChat((prev) => {
          if (!prev) return prev
          const msgs = [...active.baseMessages]
          msgs.push({
            id: active.streamingKey, role: 'assistant', content: active.streamingText,
            reasoning: active.streamingThinking || undefined,
            swipes: [], current_swipe_index: 0, timestamp: Date.now(),
          })
          return { ...prev, messages: msgs }
        })
      }
    })
  }, [])

  if (!chat) return <div className="flex flex-1 items-center justify-center text-text-muted text-[14px]">Chat not found.</div>

  const updateMessages = (messages: CharacterMessage[]) => {
    const updated = { ...chat, messages, updated_at: Date.now() }
    setChat(updated)
    saveChat(updated).catch(() => {})
  }

  const send = async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    const userMsg: CharacterMessage = {
      id: createChatId(), role: 'user', content: text,
      swipes: [], current_swipe_index: 0, timestamp: Date.now(),
    }
    const msgsWithUser = [...chat.messages, userMsg]
    updateMessages(msgsWithUser)
    setInput('')

    const model = await getDefaultModel()
    if (model) {
      setIsStreaming(true)
      const sKey = '__streaming__' + Date.now()
      const aiMsg: CharacterMessage = {
        id: sKey, role: 'assistant', content: '',
        swipes: [], current_swipe_index: 0, timestamp: Date.now(),
      }
      const msgsWithAi = [...msgsWithUser, aiMsg]
      setChat({ ...chat, messages: msgsWithAi, updated_at: Date.now() })

      try {
        await streamGenerate(
          model.providerId, model.modelId,
          msgsWithUser.map((m) => ({ role: m.role, content: m.content })),
          chat.character_id,
          chat.id,
          sKey,
          msgsWithUser,
          (delta) => {
            // Persist outside setChat so data survives unmount
            const cur = chatRef.current
            if (cur) {
              const msgs = [...cur.messages]
              const last = msgs[msgs.length - 1]
              if (last && last.id === sKey) {
                msgs[msgs.length - 1] = { ...last, content: last.content + delta }
                const updated = { ...cur, messages: msgs, updated_at: Date.now() }
                chatRef.current = updated
                saveChat(updated).catch(() => {})
              }
            }
            setChat((prev) => {
              if (!prev) return prev
              const msgs = [...prev.messages]
              const last = msgs[msgs.length - 1]
              if (last.id === sKey) {
                msgs[msgs.length - 1] = { ...last, content: last.content + delta }
              }
              return { ...prev, messages: msgs }
            })
          },
          (fullText) => {
            setIsStreaming(false)
            // Persist outside setChat
            const cur = chatRef.current
            if (cur) {
              const msgs = [...cur.messages]
              const last = msgs[msgs.length - 1]
              if (last && last.id === sKey) {
                msgs[msgs.length - 1] = { ...last, id: createChatId(), content: fullText }
                const updated = { ...cur, messages: msgs, updated_at: Date.now() }
                chatRef.current = updated
                saveChat(updated).catch(() => {})
              }
            }
            setChat((prev) => {
              if (!prev) return prev
              const msgs = [...prev.messages]
              const last = msgs[msgs.length - 1]
              if (last.id === sKey) {
                msgs[msgs.length - 1] = { ...last, id: createChatId(), content: fullText }
                const updated = { ...prev, messages: msgs, updated_at: Date.now() }
                saveChat(updated).catch(() => {})
                return updated
              }
              return prev
            })
          },
          (errMsg) => {
            setIsStreaming(false)
            const cur = chatRef.current
            if (cur) {
              const msgs = [...cur.messages]
              const last = msgs[msgs.length - 1]
              if (last && last.id === sKey) {
                msgs[msgs.length - 1] = { ...last, id: createChatId(), content: `⚠️ ${errMsg}` }
                const updated = { ...cur, messages: msgs, updated_at: Date.now() }
                chatRef.current = updated
                saveChat(updated).catch(() => {})
              }
            }
            setChat((prev) => {
              if (!prev) return prev
              const msgs = [...prev.messages]
              const last = msgs[msgs.length - 1]
              if (last.id === sKey) {
                msgs[msgs.length - 1] = { ...last, id: createChatId(), content: `⚠️ ${errMsg}` }
                const updated = { ...prev, messages: msgs, updated_at: Date.now() }
                saveChat(updated).catch(() => {})
                return updated
              }
              return prev
            })
          },
          (thinking) => {
            const cur = chatRef.current
            if (cur) {
              const msgs = [...cur.messages]
              const last = msgs[msgs.length - 1]
              if (last && last.id.startsWith('__streaming__')) {
                const prevReasoning = last.reasoning ?? ''
                msgs[msgs.length - 1] = { ...last, reasoning: prevReasoning + thinking }
                const updated = { ...cur, messages: msgs, updated_at: Date.now() }
                chatRef.current = updated
                saveChat(updated).catch(() => {})
              }
            }
            setChat((prev) => {
              if (!prev) return prev
              const msgs = [...prev.messages]
              const last = msgs[msgs.length - 1]
              if (last.id && last.id.startsWith('__streaming__')) {
                const prevReasoning = last.reasoning ?? ''
                msgs[msgs.length - 1] = { ...last, reasoning: prevReasoning + thinking }
              }
              return { ...prev, messages: msgs }
            })
          },
        )
      } catch {
        setIsStreaming(false)
        clearStream(chat.id)
        setChat((prev) => {
          if (!prev) return prev
          const msgs = prev.messages.filter((m) => m.id !== sKey)
          msgs.push({
            id: createChatId(), role: 'assistant',
            content: 'Failed to start generation. Check your model provider settings.',
            swipes: [], current_swipe_index: 0, timestamp: Date.now(),
          })
          return { ...prev, messages: msgs, updated_at: Date.now() }
        })
      }
    } else {
      // No model configured — show placeholder
      setTimeout(() => {
        const aiMsg: CharacterMessage = {
          id: createChatId(), role: 'assistant',
          content: 'No default model configured. Set one in Settings > Model Providers.',
          swipes: [], current_swipe_index: 0, timestamp: Date.now(),
        }
        updateMessages([...msgsWithUser, aiMsg])
      }, 500)
    }
  }

  const startEdit = (msg: CharacterMessage) => { setEditingId(msg.id ?? ''); setEditText(msg.content) }
  const confirmEdit = () => {
    if (!editingId) return
    updateMessages(chat.messages.map((m) => (m.id ?? '') === editingId ? { ...m, content: editText } : m))
    setEditingId(null)
  }
  const cancelEdit = () => setEditingId(null)
  const deleteMessage = (msgId: string) => { updateMessages(chat.messages.filter((m) => (m.id ?? '') !== msgId)) }
  const copyMessage = (content: string) => { navigator.clipboard.writeText(content).catch(() => {}) }

  const insertFormat = (wrapper: string) => {
    const ta = document.querySelector<HTMLTextAreaElement>('#chat-input')
    if (!ta) return
    const { selectionStart, selectionEnd, value } = ta
    const selected = value.slice(selectionStart, selectionEnd)
    ta.value = value.slice(0, selectionStart) + wrapper + selected + wrapper + value.slice(selectionEnd)
    ta.focus()
    ta.setSelectionRange(selectionStart + wrapper.length, selectionEnd + wrapper.length)
    setInput(ta.value)
  }

  const handleDeleteChat = async () => {
    await deleteChat(chat.id).catch(() => {})
    setShowDeleteConfirm(false)
    onDeleteChat?.()
  }

  const handleNewChat = () => {
    setShowNewConfirm(false)
    onNewChat?.(chat.character_id)
  }

  return (
    <div className="flex flex-1 flex-col min-w-0 min-h-0">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3 shrink-0">
        {charAvatar ? (
          <img src={charAvatar} className="h-9 w-9 rounded-lg object-cover" alt="" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent text-sm font-medium">
            {chat.title.charAt(0)}
          </div>
        )}
        <div className="flex-1">
          <h2 className="text-[15px] font-medium text-text-heading leading-tight">{chat.title}</h2>
        </div>
        {onNewChat && (
          <button onClick={() => setShowNewConfirm(true)} title="New chat with this character"
            className="flex h-8 w-8 items-center justify-center rounded text-text-muted hover:bg-input hover:text-text">
            <MessageSquarePlus size={15} />
          </button>
        )}
        <button
          onClick={() => { const next = !isFlatLayout; setIsFlatLayout(next); try { localStorage.setItem('chatFlatLayout', next ? '1' : '0') } catch {} }}
          title={isFlatLayout ? 'Switch to bubble layout' : 'Switch to flat layout'}
          className="flex h-8 w-8 items-center justify-center rounded text-text-muted hover:bg-input hover:text-text"
        >
          {isFlatLayout ? <MessageSquare size={15} /> : <AlignJustify size={15} />}
        </button>
        {onDeleteChat && (
          <button onClick={() => setShowDeleteConfirm(true)} title="Delete chat"
            className="flex h-8 w-8 items-center justify-center rounded text-text-muted hover:text-red-500 hover:bg-red-50">
            <Trash2 size={15} />
          </button>
        )}
      </header>

      <div ref={scrollRef} className={`flex-1 overflow-y-auto ${isFlatLayout ? 'px-6 py-6 space-y-0' : 'px-5 py-4 space-y-5'}`}>
        {chat.messages.map((msg, i) => {
          const isUser = msg.role === 'user'
          const mid = msg.id ?? String(i)

          if (isFlatLayout) {
            const avatarSrc = isUser ? userAvatar : charAvatar
            const avatarLetter = isUser ? ((userName ?? 'You').charAt(0)) : chat.title.charAt(0)
            return (
              <div key={mid} className="group py-3 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2 mb-1.5">
                  {avatarSrc ? (
                    <img src={avatarSrc} className="h-6 w-6 shrink-0 rounded-lg object-cover" alt="" />
                  ) : (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent text-[11px] font-medium">
                      {avatarLetter}
                    </div>
                  )}
                   <span className="text-[12px] font-semibold uppercase tracking-wider text-text">
                    {isUser ? (userName ?? 'You') : chat.title}
                  </span>
                  <div className="flex opacity-0 group-hover:opacity-100 transition-opacity gap-0.5">
                    <button onClick={() => copyMessage(msg.content)} title="Copy" className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:text-text"><Copy size={10} /></button>
                    <button onClick={() => startEdit(msg)} title="Edit" className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:text-text"><Pencil size={10} /></button>
                    <button onClick={() => deleteMessage(mid)} title="Delete" className="flex h-4 w-4 items-center justify-center rounded text-text-muted hover:text-red-500"><Trash2 size={10} /></button>
                  </div>
                </div>
                {!isUser && msg.reasoning && (
                  <details className="mb-2">
                    <summary className="text-[12px] text-text-muted cursor-pointer hover:text-text">💭 Thought for some time</summary>
                    <div className="mt-1 rounded-lg bg-thinking border border-border px-3 py-2 text-[13px] text-text-muted whitespace-pre-wrap italic">{msg.reasoning}</div>
                  </details>
                )}
                <div className="text-[14px] leading-relaxed text-text">
                  {editingId === mid ? (
                    <div className="space-y-2">
                      <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} autoFocus
                        className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-[14px] text-text outline-none resize-y" />
                      <div className="flex gap-1 justify-start">
                        <button onClick={confirmEdit} className="flex h-6 w-6 items-center justify-center rounded text-green-600 hover:bg-green-50"><Check size={14} /></button>
                        <button onClick={cancelEdit} className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-border"><X size={14} /></button>
                      </div>
                    </div>
                  ) : !msg.content && isStreaming && mid.startsWith('__streaming__') ? (
                    <span className="inline-flex gap-1">
                      <span className="animate-bounce">.</span>
                      <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '0.4s' }}>.</span>
                    </span>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}
                      components={{
                        narrative: (p: Record<string, unknown>) => <span>{p.children as React.ReactNode}</span>,
                        thinking: (p: Record<string, unknown>) => <span>{p.children as React.ReactNode}</span>,
                      } as never}>
                      {msg.content}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            )
          }

          // Bubble layout
          const avatarSrc = isUser ? userAvatar : charAvatar
          const avatarLetter = isUser ? ((userName ?? 'You').charAt(0)) : chat.title.charAt(0)
          return (
            <div key={mid} className={`group flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
              <div className={`flex items-center gap-1.5 ${isUser ? 'flex-row-reverse' : ''}`}>
                {avatarSrc ? (
                  <img src={avatarSrc} className="h-6 w-6 shrink-0 rounded-lg object-cover" alt="" />
                ) : (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent text-[11px] font-medium">
                    {avatarLetter}
                  </div>
                )}
                <span className="text-[13px] font-semibold text-text">{isUser ? (userName ?? 'You') : chat.title}</span>
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity gap-0.5">
                  <button onClick={() => copyMessage(msg.content)} title="Copy" className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:text-text"><Copy size={11} strokeWidth={1.5} /></button>
                  <button onClick={() => startEdit(msg)} title="Edit" className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:text-text"><Pencil size={11} strokeWidth={1.5} /></button>
                  <button onClick={() => deleteMessage(mid)} title="Delete" className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:text-red-500"><Trash2 size={11} strokeWidth={1.5} /></button>
                </div>
              </div>
              {!isUser && msg.reasoning && (
                <details className="mb-1 w-full">
                  <summary className="text-[12px] text-text-muted cursor-pointer hover:text-text">💭 Thought for some time</summary>
                  <div className="mt-1 rounded-lg bg-thinking border border-border px-3 py-2 text-[13px] text-text-muted whitespace-pre-wrap italic">{msg.reasoning}</div>
                </details>
              )}
              <div className={`rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed max-w-[75%] ${isUser ? 'bg-accent text-white rounded-br-md' : 'bg-input border border-border text-text rounded-bl-md'}`}>
                {editingId === mid ? (
                  <div className="space-y-2">
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} autoFocus
                      className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-[14px] text-text outline-none resize-y" />
                    <div className="flex gap-1 justify-end">
                      <button onClick={confirmEdit} className="flex h-6 w-6 items-center justify-center rounded text-green-600 hover:bg-green-50"><Check size={14} strokeWidth={1.5} /></button>
                      <button onClick={cancelEdit} className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-border"><X size={14} strokeWidth={1.5} /></button>
                    </div>
                  </div>
                ) : !msg.content && isStreaming && mid.startsWith('__streaming__') ? (
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce">.</span>
                    <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: '0.4s' }}>.</span>
                  </span>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}
                    components={{
                      narrative: (p: Record<string, unknown>) => <span>{p.children as React.ReactNode}</span>,
                      thinking: (p: Record<string, unknown>) => <span>{p.children as React.ReactNode}</span>,
                    } as never}>
                    {msg.content}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Greeting selector — only when chat has 1 assistant message with multiple swipes */}
      {chat.messages.length === 1 && chat.messages[0].role === 'assistant' && chat.messages[0].swipes.length > 1 && (
        <div className="border-t border-border shrink-0">
          <div className="max-h-28 overflow-y-auto px-4 py-2">
            <div className="flex flex-wrap gap-1">
              {chat.messages[0].swipes.map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const msgs = [...chat.messages]
                    msgs[0] = { ...msgs[0], content: msgs[0].swipes[i], current_swipe_index: i }
                    const updated = { ...chat, messages: msgs, updated_at: Date.now() }
                    setChat(updated)
                    saveChat(updated).catch(() => {})
                  }}
                  className={`flex h-7 w-7 items-center justify-center rounded text-[12px] font-medium transition-colors ${
                    chat.messages[0].current_swipe_index === i
                      ? 'bg-accent text-white'
                      : 'text-text-muted hover:bg-input hover:text-text'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-border shrink-0">
        <div className="flex items-center gap-0.5 px-4 pt-2">
          {[Bold, Italic, Quote].map((Icon, idx) => (
            <button key={idx} onClick={() => insertFormat(['**', '*', '> '][idx])} title={['Bold', 'Italic', 'Quote'][idx]}
              className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-input hover:text-text transition-colors">
              <Icon size={15} strokeWidth={1.5} />
            </button>
          ))}
          <div className="flex-1" />
          <span className="text-[11px] text-text-muted">{modelLabel}</span>
        </div>
        <div className="flex items-end gap-2 px-4 pb-4 pt-2">
          <textarea id="chat-input" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)" rows={3}
            className="flex-1 resize-none rounded-lg bg-input border border-border px-4 py-2.5 text-[14px] text-text placeholder:text-text-muted outline-none focus:border-accent/50 focus:bg-surface transition-colors" />
          <button onClick={send} disabled={!input.trim() || isStreaming}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
            <Send size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="rounded-lg bg-surface border border-border shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-medium text-text-heading">Delete Chat</h3>
            <p className="mt-2 text-[14px] text-text">Delete <strong>{chat.title}</strong> and all its messages? This cannot be undone.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="rounded-lg border border-border bg-input px-4 py-2 text-[13px] text-text hover:bg-surface transition-colors">Cancel</button>
              <button onClick={handleDeleteChat} className="rounded-lg bg-red-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {showNewConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="rounded-lg bg-surface border border-border shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-medium text-text-heading">New Chat</h3>
            <p className="mt-2 text-[14px] text-text">Start a new conversation with <strong>{chat.title}</strong>? The current chat will be kept.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowNewConfirm(false)} className="rounded-lg border border-border bg-input px-4 py-2 text-[13px] text-text hover:bg-surface transition-colors">Cancel</button>
              <button onClick={handleNewChat} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 transition-opacity">Start New</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
