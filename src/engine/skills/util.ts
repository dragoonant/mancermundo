// Helpers for the code hooks of passive.ts: which code hooks a fighter carries (through skills, fighter rules and wargear),
// their data params, and the once-per-battle ledger. Leaf module (types and state only), so rules files may import it.
import type { Fighter, GameState } from '../types'

export interface CodeUse {
  name: string
  params: Record<string, unknown>
  /** the skill, rule or wargear id that carries it */
  source: string
}

interface HasCode {
  effect?: unknown
  code?: string
  codeParams?: Record<string, unknown>
}

function fromRecord(rec: HasCode | undefined, source: string): CodeUse | null {
  if (!rec) return null
  if (typeof rec.code === 'string') return { name: rec.code, params: rec.codeParams ?? {}, source }
  const eff = rec.effect
  const list = Array.isArray(eff) ? eff : eff ? [eff] : []
  for (const e of list) {
    const c = (e as { code?: { code?: unknown; params?: Record<string, unknown> } } | null)?.code
    if (c && typeof c.code === 'string') return { name: c.code, params: c.params ?? {}, source }
  }
  return null
}

/** The code hook a skill, rule or wargear record names, or null. */
export function codeUseOf(rec: HasCode | undefined, source: string): CodeUse | null {
  return fromRecord(rec, source)
}

/** Every code hook the fighter carries: its skills, fighter rules and wargear. */
export function codesOf(state: GameState, f: Fighter): CodeUse[] {
  const out: CodeUse[] = []
  for (const id of f.skills) {
    const c = fromRecord(state.data.skills[id], id)
    if (c) out.push(c)
  }
  for (const r of f.rules) {
    const c = fromRecord(state.data.skills[r.id], r.id)
    if (c) out.push(c)
  }
  for (const id of f.wargear) {
    const c = fromRecord(state.data.wargear[id], id)
    if (c) out.push(c)
  }
  return out
}

/** All uses of a code hook on a fighter (empty when it has none; wargear can be carried twice). */
export function usesOf(state: GameState, f: Fighter, name: string): CodeUse[] {
  return codesOf(state, f).filter((c) => c.name === name)
}

const nameCache = new WeakMap<object, string | null>()

/** The code hook name of a record (cached per record object, so the hot `stat` path allocates nothing). */
function nameOf(rec: HasCode | undefined, source: string): string | null {
  if (!rec) return null
  let n = nameCache.get(rec)
  if (n === undefined) {
    n = fromRecord(rec, source)?.name ?? null
    nameCache.set(rec, n)
  }
  return n
}

export function hasCode(state: GameState, f: Fighter, name: string): boolean {
  for (const id of f.skills) if (nameOf(state.data.skills[id], id) === name) return true
  for (const r of f.rules) if (nameOf(state.data.skills[r.id], r.id) === name) return true
  for (const id of f.wargear) if (nameOf(state.data.wargear[id], id) === name) return true
  return false
}

/** The params of the first use of a code hook, or an empty object. */
export function paramsOf(state: GameState, f: Fighter, name: string): Record<string, unknown> {
  return usesOf(state, f, name)[0]?.params ?? {}
}

export function numParam(p: Record<string, unknown>, key: string, fallback: number): number {
  const v = p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** "6+" or 6 -> 6. */
export function targetParam(p: Record<string, unknown>, key: string, fallback: number): number {
  const v = p[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const m = /^(\d+)\+?$/.exec(v)
    if (m) return Number(m[1])
  }
  return fallback
}

export function usedOnce(f: Fighter, key: string): boolean {
  return !!f.used?.includes(key)
}

export function markUsed(f: Fighter, key: string): void {
  if (!f.used) f.used = []
  if (!f.used.includes(key)) f.used.push(key)
}

/**
 * Iron Man (gol): Flesh Wounds do not lower Toughness. The Flesh Wounds the stat would have lost, for the Out of Action check
 * (a fighter with Iron Man goes Out of Action once its Flesh Wounds reach its Toughness) and the Injury odds.
 */
export function ironManFlesh(state: GameState, f: Fighter): number {
  return f.fleshWounds > 0 && hasCode(state, f, 'ironMan') ? f.fleshWounds : 0
}
