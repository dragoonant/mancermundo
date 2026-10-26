// Angels of Death (docs/spec/13-teams.md section 1): the code hooks their data names. Passive rules
// (ASTARTES, the Chapter Tactics, Camo Cloak, Tilting Shields) register their name here and fire where
// the engine consults them (abilities.ts, handlers.ts); ploys, actions and the Heroic Leader / Doctrine
// Warfare cost rules live in this file.
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { addEffect, markUsedBattle, markUsedTp, usedThisTp } from '../effects'
import { cancelAction, finishAction } from '../firefight'
import { friendlyWithKeyword, hasKeyword, inEnemyCr, activeTactics, codeParams } from '../conditions'
import { registerPloyRule, type PloyOffer } from '../ploys'
import type { Ctx } from '../registry'
import { activeOps } from '../state'
import type { GameState, Operative, Seat } from '../types'
import { refreshFlags } from '../abilities'

export const DOCTRINES = ['devastator', 'tactical', 'assault'] as const
const COMBAT = 'aod.p.combat-doctrine'
const ADJUST = 'aod.p.adjust-doctrine'
const HEROIC = 'aod.a.heroic-leader'
const AUSPEX = 'aod.e.auspex'
const TACTIC_GROUP = 'chapter-tactic'

// ---------------------------------------------------------------------------
// Passive rules: the name registers so data may reference it; engine code marks it fired when it applies
// ---------------------------------------------------------------------------

for (const name of ['astartes', 'camoCloak', 'ctDueller', 'ctHardy', 'ctMobileCharge', 'ctResolute', 'ctSiegeNoAssist', 'ctStealthy', 'tiltingShields', 'grenadier']) {
  registerCodeHook({ name })
}

/** Dueller: each normal success can block one unresolved crit, except against Brutal (T-AOD.16). For the fight code's block step. */
export function normalBlocksCrit(state: GameState, blockerId: string, foeBrutal: boolean): boolean {
  const op = state.operatives[blockerId]
  if (!op || foeBrutal) return false
  const yes = activeTactics(state, op).includes('aod.a.ct-dueller')
  if (yes) markFired('ctDueller')
  return yes
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aodOps(state: GameState, seat: Seat): Operative[] {
  return activeOps(state).filter((o) => o.seat === seat && hasKeyword(state, o, 'ANGEL OF DEATH'))
}

/** The Captain, when in the killzone (and optionally out of enemy control range). */
function captainFor(state: GameState, seat: Seat, outOfCr: boolean): Operative | null {
  return friendlyWithKeyword(state, seat, 'SPACE MARINE CAPTAIN', outOfCr)
}

function chapterTacticIds(state: GameState): string[] {
  return Object.values(state.data.abilities)
    .filter((a) => a.choiceGroup === TACTIC_GROUP)
    .map((a) => a.id)
}

// ---------------------------------------------------------------------------
// Ploys
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'combatDoctrine',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (aodOps(state, seat).length === 0) return []
      return DOCTRINES.map((d) => ({ param: d }))
    },
    apply(ctx, seat, _ploy, seed) {
      ctx.state.config[seat].doctrine = seed.param ?? null
      ctx.emit({ type: 'ConfigChanged', key: 'doctrine', value: seed.param ?? null }, seat)
    },
  },
})

registerCodeHook({
  name: 'adjustDoctrine',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const cur = state.config[seat].doctrine
      if (!cur) return []
      return DOCTRINES.filter((d) => d !== cur).map((d) => ({ param: d }))
    },
    apply(ctx, seat, _ploy, seed) {
      ctx.state.config[seat].doctrine = seed.param ?? null
      ctx.emit({ type: 'ConfigChanged', key: 'doctrine', value: seed.param ?? null }, seat)
    },
  },
})

registerCodeHook({
  name: 'adaptiveTactics',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const cfg = state.config[seat]
      const taken = new Set([cfg.choices['primary-tactic'], cfg.adaptive ?? cfg.choices['secondary-tactic']])
      return chapterTacticIds(state)
        .filter((id) => !taken.has(id))
        .map((id) => ({ param: id }))
    },
    apply(ctx, seat, _ploy, seed) {
      ctx.state.config[seat].adaptive = seed.param ?? null
      ctx.emit({ type: 'ConfigChanged', key: 'secondary-tactic', value: seed.param ?? null }, seat)
      refreshFlags(ctx.state)
    },
  },
})

registerCodeHook({
  name: 'ignoreInjuredChanges',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      return aodOps(state, seat).length > 0 ? [{}] : []
    },
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
      refreshFlags(ctx.state)
    },
  },
})

registerCodeHook({
  name: 'shockAssaultStrike',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy, _seed, info) {
      const params = codeParamsOf(ploy.effect, 'shockAssaultStrike')
      if (info.subjectId) {
        addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'action', data: params })
      }
    },
  },
})

function codeParamsOf(effect: unknown, code: string): Record<string, unknown> {
  const list = Array.isArray(effect) ? effect : [effect]
  for (const e of list as { code?: string; params?: Record<string, unknown> }[]) if (e?.code === code) return e.params ?? {}
  return {}
}

// ---------------------------------------------------------------------------
// Heroic Leader, Doctrine Warfare, Auspex: costs and extra offers
// ---------------------------------------------------------------------------

registerCodeHook({ name: 'heroicLeader' })
registerCodeHook({ name: 'doctrineWarfare' })
registerCodeHook({ name: 'auspex' })

/** Doctrine Warfare: a sergeant makes the named doctrines of Combat Doctrine free, once per battle each (T-AOD.11). */
function doctrineWarfareFor(state: GameState, seat: Seat, doctrine: string): { op: Operative; key: string } | null {
  for (const op of activeOps(state)) {
    if (op.seat !== seat) continue
    const card = state.data.datacards[op.datacardId]
    for (const id of card?.abilities ?? []) {
      const def = state.data.abilities[id]
      const eff = (Array.isArray(def?.effect) ? def!.effect[0] : def?.effect) as { code?: string; params?: { doctrines?: string[] } } | undefined
      if (eff?.code !== 'doctrineWarfare' || !eff.params?.doctrines?.includes(doctrine)) continue
      const key = `dw:${doctrine}`
      if (!op.oncePerBattleUsed.includes(key)) return { op, key }
    }
  }
  return null
}

registerPloyRule({
  extraOffers(state, seat, window, info): PloyOffer[] {
    const out: PloyOffer[] = []
    const subject = info.subjectId ? state.operatives[info.subjectId] : undefined
    // Heroic Leader (b): Combat Doctrine as a friendly Angel of Death operative activates (T-AOD.10)
    if (window === 'firefight.activationStart' && !info.counteracting && subject && subject.seat === seat && hasKeyword(state, subject, 'ANGEL OF DEATH')) {
      const ploy = state.data.ploys?.[COMBAT]
      if (ploy && captainFor(state, seat, true) && !usedThisTp(state, seat, HEROIC) && !usedThisTp(state, seat, COMBAT) && ploy.cost <= state.players[seat].cp) {
        for (const d of DOCTRINES) {
          out.push({ id: `${COMBAT}:${d}@heroic`, ployId: COMBAT, name: ploy.name, param: d, cost: ploy.cost, via: 'heroicLeader', seed: { param: d } })
        }
      }
    }
    // Auspex (faction equipment): once per TP when an Angels of Death operative selects a target for Shoot
    if (window === 'firefight.actionDeclared' && info.action === 'shoot' && subject && subject.seat === seat && hasKeyword(state, subject, 'ANGEL OF DEATH')) {
      if (state.players[seat].equipment.includes(AUSPEX) && !usedThisTp(state, seat, AUSPEX)) {
        out.push({ id: AUSPEX, ployId: AUSPEX, name: 'Auspex', cost: 0, via: 'auspex', seed: {}, operativeId: subject.id })
      }
    }
    return out
  },
  costAdjust(state, seat, ploy, seed, info) {
    // Doctrine Warfare: Combat Doctrine costs 0 CP for the named doctrines
    if (ploy.id === COMBAT && seed.param) {
      const dw = doctrineWarfareFor(state, seat, seed.param)
      if (dw) return { cost: 0, via: `doctrineWarfare:${dw.op.id}:${dw.key}` }
    }
    if (usedThisTp(state, seat, HEROIC)) return null
    // Heroic Leader (c): Adjust Doctrine at 0 CP while the Captain is in the killzone and out of enemy control range
    if (ploy.id === ADJUST && captainFor(state, seat, true)) return { cost: 0, via: 'heroicLeader' }
    // Heroic Leader (a): a firefight ploy that names the Captain costs 0 CP (not Command Re-roll)
    if (ploy.type === 'firefight' && info.subjectId) {
      const subject = state.operatives[info.subjectId]
      if (subject && hasKeyword(state, subject, 'SPACE MARINE CAPTAIN')) return { cost: 0, via: 'heroicLeader' }
    }
    return null
  },
  onUsed(ctx: Ctx, seat, offer, info) {
    const via = offer.via
    if (via === 'heroicLeader') {
      markUsedTp(ctx.state, seat, HEROIC)
      markFired('heroicLeader')
    }
    else if (via?.startsWith('doctrineWarfare:')) {
      markFired('doctrineWarfare')
      const rest = via.slice('doctrineWarfare:'.length)
      const cut = rest.indexOf(':')
      const op = ctx.state.operatives[rest.slice(0, cut)]
      const key = rest.slice(cut + 1)
      if (op) {
        if (!op.oncePerBattleUsed.includes(key)) op.oncePerBattleUsed.push(key)
        markUsedBattle(ctx.state, seat, `${op.id}:${key}`)
      }
    } else if (via === 'auspex') {
      markUsedTp(ctx.state, seat, AUSPEX)
      if (info.subjectId) addEffect(ctx, { source: AUSPEX, seat, kind: 'equipment', operativeId: info.subjectId, expires: 'activation', data: { radius: 8 } })
    }
  },
})

// ---------------------------------------------------------------------------
// Unique action: OPTICS (T-AOD.14)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'optics',
  action: {
    offers(): OfferSeed[] {
      return [{ key: '', params: {} }]
    },
    perform(ctx, op) {
      if (!op) {
        cancelAction(ctx)
        return
      }
      addEffect(ctx, { source: 'aod.a.optics', seat: op.seat, kind: 'ability', operativeId: op.id, expires: `startOfActivation:${op.id}` })
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: 'aod.a.optics' }, op.seat)
      finishAction(ctx)
    },
  },
})

// Chapter Veteran: after operatives are selected each sergeant records one extra tactic (T-AOD.12).
registerCodeHook({
  name: 'chapterVeteran',
  setup(ctx, seat) {
    const s = ctx.state
    const cfg = s.config[seat]
    const taken = new Set(Object.values(cfg.choices))
    for (const op of Object.values(s.operatives)) {
      if (op.seat !== seat || !s.data.datacards[op.datacardId]?.abilities.includes('aod.a.chapter-veteran')) continue
      if (!op.extraTactics) op.extraTactics = []
      if (op.extraTactics.length === 0) {
        const pick = chapterTacticIds(s).find((id) => !taken.has(id))
        if (pick) op.extraTactics.push(pick)
      }
    }
  },
})

export { codeParams, inEnemyCr }
