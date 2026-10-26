// Close-combat fixtures (S3b): a small armoury of melee trait weapons on top of the attack bundle, and a game builder that
// keeps only the named fighters on the board, unarmed and unarmoured unless a test gives them a loadout, with the active
// fighter activated last (so its menu sees the loadouts). `answer` steps through the follow-up `fight.weapons` choices
// (first option each) with the same dice so a test scripts every roll of a sequence in one list.
import { step, type Action, type GameState, type StepResult } from '@/engine'
import type { RuntimeProfile, RuntimeWeapon, TraitRef } from '@/engine/types'
import { ScriptedRng } from '@/engine/rng'
import { attackBundle, shootingGame } from './attack'
import { activate, edit, type Spot } from './helpers'

/** 25 mm base radius in inches; two such bases touch at centre distance 2R. */
export const R = 0.492
export const TOUCH = 2 * R + 0.002

const tr = (...names: (string | [string, Partial<TraitRef>])[]): TraitRef[] =>
  names.map((n) => (typeof n === 'string' ? { trait: `core.t.${n}` } : { trait: `core.t.${n[0]}`, ...n[1] }))

function melee(id: string, p: Partial<RuntimeProfile> & { traits: TraitRef[] }): RuntimeWeapon {
  const base: RuntimeProfile = {
    id: 'std',
    name: null,
    range: { short: null, long: 'E' },
    acc: { short: null, long: null },
    str: { base: 'user', value: 0 },
    ap: 0,
    dmg: { kind: 'fixed', value: 1 },
    ammo: null,
    ...p,
  }
  return { id, name: id, class: 'close', cost: 0, flavour: 'blade', profiles: [base] }
}

export const MELEE_WEAPONS: RuntimeWeapon[] = [
  melee('cc.w.knife', { traits: tr('melee') }),
  melee('cc.w.blade', { traits: tr('melee', 'parry') }),
  melee('cc.w.power', { str: { base: 'user', value: 1 }, ap: -1, traits: tr('melee', 'power') }),
  melee('cc.w.power-parry', { str: { base: 'user', value: 1 }, ap: -1, traits: tr('melee', 'power', 'parry') }),
  melee('cc.w.shock', { traits: tr('melee', 'shock') }),
  melee('cc.w.maul', { str: { base: 'user', value: 2 }, traits: tr('melee', 'unwieldy') }),
  melee('cc.w.whip', { range: { short: null, long: 3 }, traits: tr('melee', 'versatile') }),
  melee('cc.w.disarm', { traits: tr('melee', 'disarm') }),
  melee('cc.w.entangle', { traits: tr('melee', 'entangle') }),
  melee('cc.w.paired', { traits: tr('melee', 'paired') }),
  melee('cc.w.backstab', { traits: tr('melee', 'backstab') }),
  melee('cc.w.pulverise', { traits: tr('melee', 'pulverise') }),
  melee('cc.w.sever', { traits: tr('melee', 'sever') }),
  melee('cc.w.knock', { traits: tr('melee', 'knockback') }),
  // a pistol: a Sidearm with +1 short accuracy and Ammo 4+
  melee('cc.w.stub', { range: { short: 6, long: 12 }, acc: { short: 1, long: 0 }, str: { base: 'fixed', value: 3 }, ammo: 4, traits: tr('sidearm') }),
]

const byId = <T extends { id: string }>(list: T[]): Record<string, T> => Object.fromEntries(list.map((r) => [r.id, r]))
export const meleeArmoury = { ...attackBundle.weapons, ...byId(MELEE_WEAPONS) }

export interface MeleeOpts {
  board?: string
  spots: Record<string, Spot>
  active?: string
  loadouts?: Record<string, { weapons?: string[]; wargear?: string[] }>
  /** last edit of the draft before activation (conditions, wounds ...) */
  tweak?: (d: GameState) => void
}

/** A game with only the named fighters on the board; unarmed and unarmoured unless `loadouts` says otherwise. */
export function meleeGame(opts: MeleeOpts): GameState {
  let s = shootingGame({ ...(opts.board ? { board: opts.board } : {}), spots: opts.spots })
  s = edit(s, (d) => {
    d.data = { ...d.data, weapons: meleeArmoury }
    for (const id of Object.keys(opts.spots)) {
      const f = d.fighters[id]!
      const l = opts.loadouts?.[id] ?? {}
      f.weapons = (l.weapons ?? []).map((weaponId) => ({ weaponId, ammo: 'ok' as const, lostProfiles: [] }))
      f.wargear = (l.wargear ?? []).slice()
    }
    opts.tweak?.(d)
  })
  if (opts.active) s = activate(s, opts.active).state
  return s
}

export const dice = (...v: number[]) => new ScriptedRng(v)

/** Step `action`, then answer every `fight.weapons` that follows with its first option, all with the same dice. */
export function answer(state: GameState, action: Action, rng: ScriptedRng, pick?: (p: NonNullable<GameState['pending']>) => Action | null): StepResult {
  let r = step(state, action, rng)
  let guard = 0
  while (!r.rejection && r.pending && guard++ < 20) {
    const p = r.pending
    const chosen = pick?.(p) ?? (p.kind === 'fight.weapons' ? p.options![0]!.action : null)
    if (!chosen) break
    const next = step(r.state, chosen, rng)
    if (next.rejection) return next
    r = { ...next, events: [...r.events, ...next.events] }
  }
  return r
}

/** The option of the pending decision whose payload matches `where`. */
export function optionWhere(state: GameState, where: Record<string, unknown>): Action {
  const o = state.pending!.options!.find((opt) => Object.entries(where).every(([k, v]) => JSON.stringify((opt.action.payload as Record<string, unknown>)[k]) === JSON.stringify(v)))
  if (!o) throw new Error(`no option ${JSON.stringify(where)} in ${state.pending!.kind}: ${state.pending!.options!.map((x) => x.id).join(', ')}`)
  return o.action
}
