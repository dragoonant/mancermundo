// Collapsible text boxes: every on-screen panel carries a drawer button that folds it down to its title bar,
// so the player can clear the board. Collapsed ids persist per browser in localStorage.
//
//   useCollapsed(id)                 -> [collapsed, toggle]
//   <CollapseButton id="feed" />     -> the chevron button for a panel header (stops the tap reaching the board)
//   <CollapsedTab id title testId /> -> the folded stand-in: a small title pill that re-opens the panel
import type { CSSProperties } from 'react'
import { create } from 'zustand'
import { buttonBase, colors, fontStack, panel } from './theme'

const KEY = 'ms.collapsed'

function load(): Record<string, boolean> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

interface CollapseState {
  collapsed: Record<string, boolean>
  toggle(id: string): void
  setCollapsed(id: string, v: boolean): void
}

export const useCollapse = create<CollapseState>((set, get) => ({
  collapsed: load(),
  toggle: (id) => get().setCollapsed(id, !get().collapsed[id]),
  setCollapsed: (id, v) => {
    const collapsed = { ...get().collapsed, [id]: v }
    set({ collapsed })
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(collapsed))
    } catch {
      // storage blocked (private mode): the fold still works for this session
    }
  },
}))

export function useCollapsed(id: string): [boolean, () => void] {
  const c = useCollapse((s) => !!s.collapsed[id])
  return [c, () => useCollapse.getState().toggle(id)]
}

const chevron: CSSProperties = { ...buttonBase, padding: '2px 8px', fontSize: 12, lineHeight: 1, minWidth: 28 }

/** Header button that folds the panel `id`. `title` names the panel for screen readers. */
export function CollapseButton({ id, title, style }: { id: string; title?: string; style?: CSSProperties }) {
  const [collapsed, toggle] = useCollapsed(id)
  return (
    <button
      type="button"
      data-testid={`collapse-${id}`}
      aria-label={`${collapsed ? 'Show' : 'Hide'} ${title ?? id}`}
      aria-expanded={!collapsed}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        toggle()
      }}
      style={{ ...chevron, ...style }}
    >
      {collapsed ? '▸' : '▾'}
    </button>
  )
}

/** The folded panel: a pill with the panel's title; tapping it opens the panel again. */
export function CollapsedTab({ id, title, testId, accent, style }: { id: string; title: string; testId?: string; accent?: string; style?: CSSProperties }) {
  const [, toggle] = useCollapsed(id)
  return (
    <button
      type="button"
      data-testid={testId ?? `collapsed-${id}`}
      aria-label={`Show ${title}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        toggle()
      }}
      style={{
        ...panel,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        fontFamily: fontStack,
        fontSize: 12,
        fontWeight: 700,
        color: colors.text,
        cursor: 'pointer',
        pointerEvents: 'auto',
        borderLeft: accent ? `4px solid ${accent}` : undefined,
        alignSelf: 'flex-start',
        ...style,
      }}
    >
      <span aria-hidden>▸</span>
      {title}
    </button>
  )
}
