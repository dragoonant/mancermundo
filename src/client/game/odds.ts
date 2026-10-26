// View-models for the numbers the prompts and cards show. Every figure is read from the engine (`query.*`, `option.data`,
// `pending.context`); this file only gathers and names them. A query that is missing (an engine part that has not landed) or that
// throws gives null and the prompt falls back to the option's own facts. Pure: no store, no DOM.
import { query, type DecisionOption, type GameState, type PendingDecision, type RuntimeProfile, type RuntimeWeapon, type StatKey } from '@/engine'

export const pct = (n: number | null | undefined): string => (typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 100)}%` : '-')
export const plus = (n: number | null | undefined): string => (typeof n === 'number' ? `${n}+` : '-')
const round1 = (n: number): string => String(Math.round(n * 10) / 10)

type Dyn = Record<string, ((...a: unknown[]) => unknown) | undefined>
const dyn = (): Dyn => query as unknown as Dyn

function attempt<T>(f: () => T): T | null {
  try {
    return f()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- shooting

export interface ShotOdds {
  targetId: string
  distance: number | null
  band: 'short' | 'long' | null
  cover: 'none' | 'partial' | 'full' | null
  /** the final number the hit roll needs on the D6 */
  hitNeed: number | null
  pHit: number
  woundNeed: number | null
  pWound: number
  saveNeed: number | null
  pSave: number
  pPinned: number
  pSeriouslyInjured: number
  pOutOfAction: number
  expectedHits: number
  expectedWounds: number
  priority: 'closest' | 'free' | 'coolTest' | null
  coolNeed: number | null
  modifiers: { label: string; value: number }[]
}

type Data = Record<string, unknown>

function profileOf(state: GameState, weaponId: string, profileId: string): RuntimeProfile | undefined {
  return state.data.weapons[weaponId]?.profiles.find((p) => p.id === profileId)
}

/** Wound roll number from the chance the engine reports: 1 - (need - 1) / 6, so need = 7 - 6 * chance. */
function needFromChance(chance: number): number | null {
  if (chance <= 0) return null
  return Math.max(2, Math.min(6, Math.round(7 - chance * 6)))
}

/** The engine's odds for one shot of the pending shoot decision at the target an option names. */
export function shotOdds(state: GameState, pending: PendingDecision, opt: DecisionOption): ShotOdds | null {
  const ctx = pending.context as Data
  const shooter = String(ctx.fighterId ?? '')
  const weaponId = String(ctx.weaponId ?? '')
  const profileId = String(ctx.profileId ?? '')
  const targetId = (opt.action.payload as { targetId?: string }).targetId
  if (!shooter || !weaponId || !profileId || !targetId) return null
  const mode = (ctx.mode === 'blindFire' || ctx.mode === 'fireDuct' ? ctx.mode : 'shoot') as 'shoot' | 'blindFire' | 'fireDuct'
  const profile = profileOf(state, weaponId, profileId)
  if (!profile) return null
  const eo = attempt(() => query.expectedOutcome(state, shooter, weaponId, profileId, targetId, mode))
  if (!eo) return null
  const d = (opt.data ?? {}) as Data
  const traits = profile.traits.map((t) => t.trait)
  const vs = traits.some((t) => t.endsWith('.t.template')) ? 'template' : traits.some((t) => t.endsWith('.t.blast')) ? 'blast' : null
  const save = attempt(() => query.saveChance(state, targetId, profile.ap, { fromId: shooter, vs }))
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
  const mods = Array.isArray(d.modifiers) ? (d.modifiers as { label?: unknown; value?: unknown }[]).filter((m) => typeof m.label === 'string' && typeof m.value === 'number').map((m) => ({ label: m.label as string, value: m.value as number })) : []
  const cool = d.coolTest && typeof d.coolTest === 'object' ? num((d.coolTest as Data).need) : null
  return {
    targetId,
    distance: num(d.distance),
    band: d.band === 'short' || d.band === 'long' ? d.band : null,
    cover: d.cover === 'none' || d.cover === 'partial' || d.cover === 'full' ? d.cover : null,
    hitNeed: num(d.need),
    pHit: eo.pHit,
    woundNeed: needFromChance(eo.pWoundPerHit),
    pWound: eo.pWoundPerHit,
    saveNeed: save?.need ?? null,
    pSave: save ? save.chance : 1 - eo.pUnsaved,
    pPinned: eo.pPinned,
    pSeriouslyInjured: eo.pSeriouslyInjured,
    pOutOfAction: eo.pOutOfAction,
    expectedHits: eo.expectedHits,
    expectedWounds: eo.expectedWounds,
    priority: d.priority === 'closest' || d.priority === 'free' || d.priority === 'coolTest' ? d.priority : null,
    coolNeed: cool,
    modifiers: mods,
  }
}

/** A one-line verdict for a shot: "about 0.4 Wounds expected, 12% to put the target Out of Action". */
export function shotSummary(o: ShotOdds): string {
  const ooa = o.pOutOfAction >= 0.005 ? `${pct(o.pOutOfAction)} Out of Action` : null
  const si = o.pSeriouslyInjured >= 0.005 ? `${pct(o.pSeriouslyInjured)} Seriously Injured` : null
  const parts = [`${round1(o.expectedWounds)} Wounds expected`, ooa, si].filter(Boolean)
  return parts.join(' · ')
}

// ---------------------------------------------------------------- weapon profile lines (fighter card, weapon choice)

export interface ProfileLine {
  weaponId: string
  weaponName: string
  profileId: string
  profileName: string | null
  weaponClass: string
  range: string
  acc: string
  strength: string
  ap: string
  damage: string
  ammo: string
  traits: { trait: string; x?: number; inches?: number; target?: number }[]
  ammoState: 'ok' | 'out' | 'jammed' | 'spent'
  lost: boolean
}

function rangeText(r: RuntimeProfile['range']): string {
  const side = (v: unknown): string => {
    if (v === null || v === undefined) return '-'
    if (v === 'E') return 'Engaged'
    if (v === 'T') return 'Template'
    if (typeof v === 'number') return `${v}"`
    if (typeof v === 'object' && v && 'strMultiplier' in v) return `S x${(v as { strMultiplier: number }).strMultiplier}"`
    return String(v)
  }
  return `${side(r.short)} / ${side(r.long)}`
}

const signed = (n: number | null | undefined): string => (n === null || n === undefined ? '-' : n > 0 ? `+${n}` : String(n))

/** One profile as a table line. `strength` is the printed Strength text (the wielder's value, or "S" / "S+1" with no wielder). */
export function lineFor(w: RuntimeWeapon, p: RuntimeProfile, strength: string, ammoState: ProfileLine['ammoState'] = 'ok', lost = false): ProfileLine {
  return {
    weaponId: w.id,
    weaponName: w.name,
    profileId: p.id,
    profileName: p.name,
    weaponClass: w.class,
    range: rangeText(p.range),
    acc: `${signed(p.acc.short)} / ${signed(p.acc.long)}`,
    strength,
    ap: p.ap === 0 ? '-' : String(p.ap),
    damage: p.dmg.kind === 'fixed' ? String(p.dmg.value) : p.dmg.kind === 'dice' ? p.dmg.expr : '-',
    ammo: p.ammo === null ? '-' : `${p.ammo}+`,
    traits: p.traits.map((t) => ({ trait: t.trait, ...(t.x !== undefined ? { x: t.x } : {}), ...(t.inches !== undefined ? { inches: t.inches } : {}), ...(t.target !== undefined ? { target: t.target } : {}) })),
    ammoState,
    lost,
  }
}

/** Strength text of a profile: the wielder's number when known ("5", "6"), else "S" or "S+1". */
export function strengthText(p: RuntimeProfile, wielderS: number | null): string {
  if (p.str.base === 'fixed') return String(p.str.value)
  if (wielderS !== null) return String(wielderS + p.str.value)
  return p.str.value === 0 ? 'S' : `S${p.str.value > 0 ? '+' : ''}${p.str.value}`
}

/** Every profile of every weapon a fighter carries with its full line (S/L range, accuracy, S, AP, D, Am, traits). */
export function profileLines(state: GameState, fighterId: string): ProfileLine[] {
  const f = state.fighters[fighterId]
  if (!f) return []
  const s = attempt(() => query.stat(state, f.id, 'S'))
  const out: ProfileLine[] = []
  for (const fw of f.weapons) {
    const w = state.data.weapons[fw.weaponId]
    if (!w) continue
    for (const p of w.profiles) out.push(lineFor(w, p, strengthText(p, s), fw.ammo, fw.lostProfiles.includes(p.id)))
  }
  return out
}

// ---------------------------------------------------------------- charge, fight, nerve, bottle (engine parts that may not exist yet)

export interface FightOdds {
  /** attack dice of the combination */
  dice: number
  targets: { targetId: string; dice: number; need: number; expectedHits: number; expectedWounds: number; pSeriouslyInjured: number; pOutOfAction: number }[]
  /** the reaction attacks that follow, if every target stays standing */
  reactions: { fighterId: string; dice: number; need: number; expectedHits: number; expectedWounds: number }[]
}

/** `query.fightOutcome` for a weapon combination against targets (null when the engine cannot work it out). */
export function fightOdds(state: GameState, attackerId: string, weaponIds: string[] | undefined, targetIds: string[] | undefined, charge = false): FightOdds | null {
  const r = attempt(() => query.fightOutcome(state, attackerId, weaponIds, targetIds, { charge }))
  return r ? { dice: r.dice, targets: r.targets, reactions: r.reactions } : null
}

export interface NerveOdds {
  /** the 2D6 target (Cool, less supporters) */
  need: number
  supporters: number
  pPass: number
}

/** The nerve test a fighter would take now: the need, how many friends steady it, the exact chance. */
export function nerveOdds(state: GameState, fighterId: string): NerveOdds | null {
  const r = attempt(() => query.nerveOdds(state, fighterId))
  return r ? { need: r.need, supporters: r.supporters.length, pPass: r.chance } : null
}

export interface BottleOdds {
  /** the engine's chance the gang bottles now (`query.bottleOdds`, S4), or null while it has none */
  pBottle: number | null
  down: number
  crew: number
}

/** The Bottle test position of a gang: fighters down against its starting crew, and the chance when the engine can say. */
export function bottleOdds(state: GameState, seat: 'A' | 'B'): BottleOdds | null {
  const fn = (query as unknown as Record<string, ((s: GameState, seat: string) => unknown) | undefined>).bottleOdds
  const down = Object.values(state.fighters).filter((f) => f.seat === seat && (f.location === 'outOfAction' || f.location === 'fled' || f.posture === 'seriouslyInjured')).length
  const crew = state.players[seat].startingCrew
  const r = fn ? (attempt(() => fn(state, seat)) as { pBottle?: number; chance?: number } | number | null) : null
  const p = typeof r === 'number' ? r : r && typeof r === 'object' ? (r.pBottle ?? r.chance ?? null) : null
  return { pBottle: typeof p === 'number' ? p : null, down, crew }
}

// ---------------------------------------------------------------- characteristics shown on the card

export const STAT_KEYS: StatKey[] = ['M', 'WS', 'BS', 'S', 'T', 'W', 'I', 'A', 'Ld', 'Cl', 'Wil', 'Int']

/** A characteristic as printed on a profile line: inches for M, "4+" for target numbers, a plain number otherwise. */
export function statText(key: StatKey, value: number): string {
  return key === 'M' ? `${value}"` : query.isTargetNumber(key) ? `${value}+` : String(value)
}
