export type Panel = 'chat' | 'characters' | 'worldbook' | 'personas' | 'settings' | 'inspector' | null

export interface CharacterIndexEntry {
  id: string
  name: string
  kind: string
  created_at: number
  updated_at: number
}

export interface CharacterData {
  id: string
  name: string
  description: string
  personality: string
  scenario: string
  firstMessage: string
  alternateGreetings: string[]
  exampleMessages: string
  systemPrompt: string
  tags: string[]
  creator: string
  version: string
  kind: string
  icon: string
  avatarPath: string | null
  linkedWorldBook: string | null
  createdAt: number
  updatedAt: number
}
