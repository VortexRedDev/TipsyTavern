export interface InspectorMessage {
  role: string
  content: string
}

export interface InspectorEntry {
  id: string
  systemPrompt: string
  messages: InspectorMessage[]
  modelId: string
  providerId: string
  characterName: string | null
  worldInfoActivated: number
  worldInfoTokensUsed: number
  timestamp: number
  messageCount: number
}

const MAX_ENTRIES = 50
const store: InspectorEntry[] = []
let listeners: (() => void)[] = []
let version = 0

export function getInspectorEntries(): InspectorEntry[] {
  return store
}

export function getInspectorVersion(): number {
  return version
}

export function addInspectorEntry(entry: InspectorEntry) {
  store.unshift(entry)
  if (store.length > MAX_ENTRIES) store.length = MAX_ENTRIES
  version++
  listeners.forEach((fn) => fn())
}

export function subscribeInspector(fn: () => void) {
  listeners.push(fn)
  return () => { listeners = listeners.filter((l) => l !== fn) }
}
