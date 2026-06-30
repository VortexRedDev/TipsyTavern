import { useEffect } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const ACCENTS: Record<string, Record<string, string>> = {
  purple: { primary: '#aa3bff', bg: 'rgba(170,59,255,0.1)', border: 'rgba(170,59,255,0.5)' },
  blue:   { primary: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.5)' },
  sky:    { primary: '#0ea5e9', bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.5)' },
  green:  { primary: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.5)' },
  teal:   { primary: '#14b8a6', bg: 'rgba(20,184,166,0.1)', border: 'rgba(20,184,166,0.5)' },
  amber:  { primary: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.5)' },
  orange: { primary: '#f97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.5)' },
  rose:   { primary: '#f43f5e', bg: 'rgba(244,63,94,0.1)', border: 'rgba(244,63,94,0.5)' },
  red:    { primary: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.5)' },
  violet: { primary: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.5)' },
}

export const ACCENT_NAMES = Object.keys(ACCENTS)

export function getAccentColor(name: string): string {
  return ACCENTS[name]?.primary ?? ACCENTS['purple'].primary
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', isDark)
  try { localStorage.setItem('theme', theme) } catch {}
}

export function applyAccent(name: string) {
  const root = document.documentElement
  const c = ACCENTS[name] ?? ACCENTS['purple']
  root.style.setProperty('--color-accent', c.primary)
  root.style.setProperty('--color-accent-bg', c.bg)
  root.style.setProperty('--color-accent-border', c.border)
  try { localStorage.setItem('accent', name) } catch {}
}

export function getStoredAccent(): string {
  try { return localStorage.getItem('accent') || 'purple' } catch { return 'purple' }
}

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem('theme')
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {}
  return 'system'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const theme = getStoredTheme()
    applyTheme(theme)
    applyAccent(getStoredAccent())

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (getStoredTheme() === 'system') applyTheme('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return <>{children}</>
}
