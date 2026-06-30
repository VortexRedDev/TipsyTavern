import { useState, useEffect } from 'react'
import type { Panel } from './types'
import ActivityBar from './components/ActivityBar'
import { ThemeProvider } from './components/ThemeProvider'
import { TitleBar } from './components/TitleBar'
import { ChatList } from './features/chat/ChatList'
import { ChatWorkspace } from './features/chat/ChatWorkspace'
import { CharacterList } from './features/characters/CharacterList'
import { CharacterWorkspace } from './features/characters/CharacterWorkspace'
import { WorldBookList } from './features/worldbook/WorldBookList'
import { WorldBookWorkspace } from './features/worldbook/WorldBookWorkspace'
import { SettingsList } from './features/settings/SettingsList'
import { SettingsWorkspace } from './features/settings/SettingsWorkspace'
import { PersonaList } from './features/personas/PersonaList'
import { PersonaWorkspace } from './features/personas/PersonaWorkspace'
import { InspectorList } from './features/inspector/InspectorList'
import { InspectorWorkspace } from './features/inspector/InspectorWorkspace'
import { getInspectorEntries, getInspectorVersion, subscribeInspector } from './lib/inspector'
import { loadCharacter } from './lib/characters'
import { saveChat, createChatId, type ChatData } from './lib/chats'

const listComponents = {
  chat: ChatList,
  characters: CharacterList,
  worldbook: WorldBookList,
  settings: SettingsList,
}

const workspaceComponents = {
  chat: ChatWorkspace,
  characters: CharacterWorkspace,
  worldbook: WorldBookWorkspace,
  settings: SettingsWorkspace,
}

function App() {
  const [activePanel, setActivePanel] = useState<Panel>('chat')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [inspectorVersion, setInspectorVersion] = useState(0)
  const [listCollapsed, setListCollapsed] = useState(false)

  const handleDeleted = () => {
    setSelectedItemId(null)
    setRefreshKey((k) => k + 1)
  }

  useEffect(() => {
    setInspectorVersion(getInspectorVersion())
    return subscribeInspector(() => setInspectorVersion((v) => v + 1))
  }, [])

  const handleStartChat = async (characterId: string, characterName: string) => {
    let firstMessage = ''
    let allGreetings: string[] = []
    try {
      const char = await loadCharacter(characterId)
      if (char) {
        firstMessage = char.firstMessage
        allGreetings = [char.firstMessage, ...char.alternateGreetings].filter(Boolean)
      }
    } catch {}

    const chat: ChatData = {
      id: createChatId(),
      title: characterName,
      character_id: characterId,
      created_at: Date.now(),
      updated_at: Date.now(),
      messages: firstMessage ? [{
        role: 'assistant', content: firstMessage,
        swipes: allGreetings, current_swipe_index: 0, timestamp: Date.now(),
      }] : [],
    }

    try { await saveChat(chat) } catch {}
    setActivePanel('chat')
    setRefreshKey((k) => k + 1)
    setSelectedItemId(chat.id)
  }

  const handleDeleteChat = () => {
    setSelectedItemId(null)
    setRefreshKey((k) => k + 1)
  }

  const switchPanel = (p: Panel) => {
    if (p === null) {
      setListCollapsed(!listCollapsed)
      return
    }
    setActivePanel(p)
    setSelectedItemId(null)
    setListCollapsed(false)
  }

  const ListComponent = activePanel ? listComponents[activePanel] : null
  const WorkspaceComponent = activePanel ? workspaceComponents[activePanel] : null

  return (
    <ThemeProvider>
    <div className="flex h-full flex-col bg-surface">
      <TitleBar />
      <div className="flex flex-1 w-full min-h-0">
        <ActivityBar active={activePanel} onSelect={switchPanel} />
        <div className={listCollapsed ? 'hidden' : 'contents'}>
        {activePanel && ListComponent && (
          <ListComponent
            onClose={() => { setListCollapsed(true) }}
            onSelect={setSelectedItemId}
            selectedItemId={selectedItemId}
            refreshTrigger={['characters', 'worldbook', 'chat'].includes(activePanel) ? refreshKey : 0}
            {...(activePanel === 'characters' ? { onStartChat: handleStartChat } : {})}
          />
        )}
        {activePanel === 'inspector' && (
          <InspectorList
            entries={[...getInspectorEntries()]}
            selectedId={selectedItemId}
            onClose={() => { setListCollapsed(true) }}
            onSelect={setSelectedItemId}
          />
        )}
        {activePanel === 'personas' && (
          <PersonaList
            selectedItemId={selectedItemId}
            onClose={() => { setListCollapsed(true) }}
            onSelect={setSelectedItemId}
            refreshTrigger={refreshKey}
          />
        )}
        </div>
        <main className="flex flex-1 flex-col min-w-0">
          {activePanel === 'inspector' ? (
            <InspectorWorkspace
              entry={[...getInspectorEntries()].find((e) => e.id === selectedItemId) ?? null}
            />
          ) : activePanel === 'personas' && selectedItemId ? (
            <PersonaWorkspace
              selectedItemId={selectedItemId}
              onDeleted={handleDeleted}
              onSaved={() => setRefreshKey((k) => k + 1)}
            />
          ) : activePanel && selectedItemId && WorkspaceComponent ? (
            activePanel === 'worldbook'
              ? <WorkspaceComponent selectedItemId={selectedItemId} onDeleted={handleDeleted} />
              : activePanel === 'characters'
              ? <WorkspaceComponent selectedItemId={selectedItemId} onDeleted={handleDeleted} />
              : activePanel === 'chat'
              ? <WorkspaceComponent selectedItemId={selectedItemId}
                  onDeleteChat={handleDeleteChat}
                  onNewChat={async (characterId) => {
                    try { const char = await loadCharacter(characterId); handleStartChat(characterId, char?.name ?? 'New Chat') } catch {}
                  }}
                />
              : <WorkspaceComponent selectedItemId={selectedItemId} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <h1 className="text-[48px] font-medium leading-none tracking-[-1.44px] text-text-heading max-lg:text-[36px] max-lg:tracking-normal">
                TipsyTavern
              </h1>
              <p className="mt-4 max-w-sm text-text">
                Select a conversation or start a new chat to begin.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
    </ThemeProvider>
  )
}

export default App
