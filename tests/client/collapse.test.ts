// Collapsible text boxes: every floating panel folds to a title pill and back; the fold persists in
// localStorage; folding the dice tray changes only its DOM view, never the tray store the director writes.
// The components are rendered to static markup on a fresh module graph so the stored fold is the initial state.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'ms.collapsed'
let store: Record<string, string>

beforeEach(() => {
  store = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k]! : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
  })
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const pool = (side: 'attack' | 'defence') => ({
  operativeId: side === 'attack' ? 'A1' : 'B1',
  seat: null,
  label: side === 'attack' ? 'Shooter' : 'Target',
  need: 4,
  lethal: null,
  side,
  word: (side === 'attack' ? 'hit' : 'save') as 'hit' | 'save',
  dice: [{ value: 6, kind: 'crit' as const, rerolled: false, spent: null, pair: null }],
})

describe('collapsible panels', () => {
  it('COLLAPSE-001 a panel folds to its title pill and opens again from the pill', async () => {
    store[KEY] = JSON.stringify({ feed: true })
    const { PanelBox } = await import('@/client/ui/Panels')
    const html = (id: 'feed' | 'log') =>
      renderToStaticMarkup(createElement(PanelBox, { id, title: id === 'feed' ? 'Event feed' : 'Dice log', testId: `${id}-box`, open: true, side: 'right', children: createElement('p', null, 'body') }))
    const folded = html('feed')
    expect(folded).toContain('data-testid="collapsed-feed"')
    expect(folded).not.toContain('feed-box')
    expect(folded).not.toContain('body')
    const open = html('log')
    expect(open).toContain('data-testid="log-box"')
    expect(open).toContain('data-testid="collapse-log"')
    expect(open).not.toContain('collapsed-log')
    // the pill is a button that toggles through the shared store
    const { useCollapse } = await import('@/client/ui/collapse')
    useCollapse.getState().toggle('feed')
    expect(useCollapse.getState().collapsed.feed).toBe(false)
  })

  it('COLLAPSE-002 the fold persists through localStorage and survives a reload', async () => {
    const first = await import('@/client/ui/collapse')
    first.useCollapse.getState().setCollapsed('mission', true)
    first.useCollapse.getState().toggle('card')
    expect(JSON.parse(store[KEY]!)).toEqual({ mission: true, card: true })
    vi.resetModules()
    const reloaded = await import('@/client/ui/collapse')
    expect(reloaded.useCollapse.getState().collapsed).toEqual({ mission: true, card: true })
    reloaded.useCollapse.getState().toggle('mission')
    expect(JSON.parse(store[KEY]!).mission).toBe(false)
  })

  it('COLLAPSE-003 folding the dice tray hides only the DOM; the tray store keeps filling', async () => {
    const tray = { mode: 'shoot' as const, title: 'A shoots B with Lasgun', atk: pool('attack'), def: pool('defence'), note: '', rev: 1 }
    const { DiceTrayView } = await import('@/client/dice/DiceTray')
    const open = renderToStaticMarkup(createElement(DiceTrayView, { tray, compact: false }))
    expect(open).toContain('data-testid="dice-tray"')
    expect(open).toContain('data-testid="tray-atk"')
    expect(open).toContain('data-testid="tray-def"')
    expect(open).toContain('data-testid="collapse-dicetray"')

    vi.resetModules()
    store[KEY] = JSON.stringify({ dicetray: true })
    const view = await import('@/client/dice/DiceTray')
    const folded = renderToStaticMarkup(createElement(view.DiceTrayView, { tray, compact: false }))
    expect(folded).toContain('data-testid="collapsed-dicetray"')
    expect(folded).not.toContain('tray-die')
    expect(renderToStaticMarkup(createElement(view.DiceTrayView, { tray: { ...tray, atk: null }, compact: true }))).toBe('')

    // the director's writes go to the store regardless of the fold
    const ts = await import('@/client/dice/trayStore')
    ts.trayBegin('shoot', 'A shoots B with Lasgun')
    ts.trayAttack({ operativeId: 'A1', seat: null, label: 'Shooter', need: 4, lethal: null, dice: [6, 2], kinds: ['crit', 'fail'] }, 'shoot', 'A shoots B with Lasgun')
    expect(ts.useTray.getState().atk?.dice.map((d) => d.value)).toEqual([6, 2])
  })
})
