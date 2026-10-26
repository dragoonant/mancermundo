// Pathfinders (docs/spec/13-teams.md section 3, rule ids T-PF.n): the code hooks this team's data names, its team
// rule provider (team-rules.ts registerTeamRules) and its hook handlers (hooks.ts registerHook). Everything the
// team needs is built on the M9 generic capabilities; no shared engine file names Pathfinders.
//
//  - Markerlight tokens: tokens.ts kind 'pf.markerlight' (cap 4, owned by the Pathfinder player), benefits read off
//    the target by modifyWeaponRules / modifyAttackDice / target.status / beforeShootTargetSelect, decay from the
//    action.ended hook.
//  - Drones: team-rules providers (action whitelist, control APL, Move), Remote Pilot through startDelegatedAction.
//  - Medic!: beforeIncapacitated (conditions) + the operative.incapacitated hook (the owner's choice, saveFromRemoval)
//    + pausableRemoval + onDamageInflicted + a reaction for the free Dash.
//  - Ploys, equipment and unique actions are code hooks (code-hooks.ts); passive rules call markFired where they bite.
import {
  applyAplEffect,
  continueRemovals,
  effectiveRules,
  parseRules,
  redirectAttack,
  ruleSetFor,
  saveFromRemoval,
  targetInfo,
  validTargets,
} from '../attack-common'
import { getCodeHook, markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { codeOf, codeParams, evalCondition, hasAbility, hasKeyword, inEnemyCr, normAction } from '../conditions'
import { commsBonus } from '../core-hooks'
import { addEffect, aplChangeNextActivation, addTpUse, markUsedBattle, markUsedTp, regainWounds, removeEffects, tpUsesOf, usedThisBattle, usedThisTp } from '../effects'
import { cancelAction, finishAction, REACTION_DONE, reactionDone, startDelegatedAction, startFreeAction } from '../firefight'
import { registerFrameResume, registerHook, type HookContext } from '../hooks'
import { bodyOf, visible } from '../los'
import { distanceBetween, enemiesInControlRange, inControlRange, isWithin } from '../measure'
import { missionActionIds } from '../missions'
import { registerPloyRule, type PloyOffer } from '../ploy-rules'
import { continueWindow } from '../ploys'
import type { Ctx } from '../registry'
import { activeOps, enemiesOf, friendsOf, hasInjuredPenalty, isInjured, otherSeat } from '../state'
import { resumeGambit } from '../strategy'
import { registerTeamRules, type ReactionOffer } from '../team-rules'
import { addToken, hasToken, removeToken, tokenCount } from '../tokens'
import type { ActiveEffect, Activation, AttackState, Condition, DiceSide, GameState, Operative, RuntimeAbility, Seat, Vec3, WeaponRuleRef } from '../types'

export const TEAM_ID = 'pathfinders'

const ML = 'pf.markerlight'
const PHOTON = 'pf.photon'
const PULSE = 'pf.pulse'
const ML_CAP = 4
const FUSION = 'pf.w.fusion-grenade'
const MARKSMAN_GROUP = 'pf.wg.marksman-rail-rifle'
const AOW = 'pf.p.art-of-war'
const SUPPRESS = 'pf.p.suppressing-fire'
const BONDED = 'pf.p.bonded'
const TAKE_COVER = 'pf.p.take-cover'
const SUPPORTING = 'pf.p.supporting-fire'
const SAVIOUR = 'pf.p.saviour-protocols'
const PBF = 'pf.p.point-blank-fusillade'
const TAO = 'pf.e.target-analysis-optic'
const HIML = 'pf.e.high-intensity-markerlight'
const PHOTON_EQ = 'pf.e.photon-grenade'
const OSU = 'pf.e.orbital-survey-uplink'

// passive rules and ploys register their name here; the engine code below marks them fired when they apply
for (const name of [
  'markerlightRules',
  'droneController',
  'inertialDampener',
  'groupActivation',
  'multiDimensionalVision',
  'pfDrone',
  'analyse',
  'shieldGenerator',
  'mv7Markerlight',
  'gravInhibitor',
  'targetAnalysisOptic',
  'highIntensityMarkerlight',
  'orbitalSurveyUplink',
]) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

const isPf = (s: GameState, op: Operative): boolean => hasKeyword(s, op, 'PATHFINDER')
const isDrone = (s: GameState, op: Operative): boolean => hasKeyword(s, op, 'DRONE')

function seatOpsActive(s: GameState, seat: Seat): Operative[] {
  return activeOps(s).filter((o) => o.seat === seat && o.wounds > 0)
}

/** Friendly operatives (active) of the seat whose datacard carries this ability id. */
function withAbility(s: GameState, seat: Seat, abilityId: string): Operative[] {
  return seatOpsActive(s, seat).filter((o) => hasAbility(s, o, abilityId))
}

/** The weapon is a pulse weapon (T-PF.5): burst cannon, pulse carbine, suppressed or twin pulse carbine. */
export function isPulseWeapon(s: GameState, weaponId: string): boolean {
  const n = (s.data.weapons[weaponId]?.name ?? '').toLowerCase()
  return n.includes('pulse carbine') || n.includes('burst cannon')
}

/** The weapon is on the operative's own datacard (fixed or in a legal loadout), as the Markerlight benefits require. */
function onOwnCard(s: GameState, op: Operative, weaponId: string): boolean {
  const card = s.data.datacards[op.datacardId]
  return !!card && (card.fixedWeapons.includes(weaponId) || (card.legalLoadouts ?? []).some((l) => l.includes(weaponId)))
}

/** Markerlight benefits apply to a Pathfinder shooting with a ranged weapon from its datacard, not the fusion grenade. */
function benefitWeapon(s: GameState, op: Operative, weaponId: string): boolean {
  return isPf(s, op) && weaponId !== FUSION && s.data.weapons[weaponId]?.type === 'ranged' && onOwnCard(s, op, weaponId)
}

function effectFor(s: GameState, kind: string, opId: string): ActiveEffect | undefined {
  return s.effects.find((e) => e.kind === kind && e.operativeId === opId)
}

function ployEffect(s: GameState, source: string, seat: Seat): boolean {
  return s.effects.some((e) => e.source === source && e.seat === seat)
}

/** Markerlight tokens of the shooter's player on the target, with Target Analysis Optic's +1 when it is in play (T-PF.39). */
function effectiveTokens(s: GameState, shooter: Operative, targetId: string): number {
  const n = tokenCount(s, targetId, ML, shooter.seat)
  if (n < 1) return n
  const optic = s.effects.some((e) => e.source === TAO && e.operativeId === shooter.id)
  if (!optic) return n
  const a = s.attack
  // only the primary target is affected when the weapon has Blast or Torrent
  if (a && a.targets.length > 0 && a.targets[0] !== targetId) return n
  return n + 1
}

function hasRef(rules: WeaponRuleRef[], name: string): boolean {
  return rules.some((r) => r.rule === name)
}

function uniqueLink(s: GameState, shooterId: string) {
  return s.effects.find((e) => e.kind === 'pf.link' && e.operativeId === shooterId)
}

/** Edge geometry of the killzone: 'west' x-, 'east' x+, 'north' z-, 'south' z+. */
type Edge = 'west' | 'east' | 'north' | 'south'
const EDGES: Edge[] = ['west', 'east', 'north', 'south']

function edgeGap(s: GameState, edge: Edge, pos: { x: number; z: number }): number {
  const hx = s.map.size.x / 2
  const hz = s.map.size.z / 2
  switch (edge) {
    case 'west':
      return pos.x + hx
    case 'east':
      return hx - pos.x
    case 'north':
      return pos.z + hz
    case 'south':
      return hz - pos.z
  }
}

/** Is the base wholly within `inches` of the killzone edge? */
export function whollyWithinEdge(s: GameState, edge: Edge, op: { pos: Vec3; baseRadius: number }, inches: number): boolean {
  return edgeGap(s, edge, op.pos) + op.baseRadius <= inches + 1e-6
}

/** The killzone edge nearest the player's drop zone. */
export function ownEdge(s: GameState, seat: Seat): Edge | null {
  const zone = s.map.dropZones.find((z) => z.id === s.players[seat].dropZoneId)
  if (!zone || zone.polygon.length === 0) return null
  const c = {
    x: zone.polygon.reduce((n, p) => n + p.x, 0) / zone.polygon.length,
    z: zone.polygon.reduce((n, p) => n + p.z, 0) / zone.polygon.length,
  }
  let best: Edge = 'west'
  let bd = Infinity
  for (const e of EDGES) {
    const d = edgeGap(s, e, c)
    if (d < bd) {
      bd = d
      best = e
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Art of War, Mont'ka and Kauyon (T-PF.7, T-PF.8)
// ---------------------------------------------------------------------------

type Doctrine = 'montka' | 'kauyon'

/** The Art of War option that applies to this operative now (the team's pick, swapped by Veteran for the Blooded). */
function doctrineFor(s: GameState, op: Operative): Doctrine | null {
  const fx = s.effects.find((e) => e.kind === 'pf.aow' && e.seat === op.seat)
  if (!fx) return null
  const picked = fx.data?.option as Doctrine
  if (s.effects.some((e) => e.kind === 'pf.veteran' && e.operativeId === op.id)) return picked === 'montka' ? 'kauyon' : 'montka'
  return picked
}

registerCodeHook({
  name: 'artOfWar',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      if (withAbility(state, seat, 'pf.a.art-of-war').length === 0) return []
      return (['montka', 'kauyon'] as const).filter((o) => !usedThisBattle(state, seat, `pf.aow:${o}`)).map((o) => ({ param: o }))
    },
    apply(ctx, seat, ploy, seed) {
      const option = seed.param as Doctrine
      markUsedBattle(ctx.state, seat, `pf.aow:${option}`)
      addEffect(ctx, { source: ploy.id, seat, kind: 'pf.aow', expires: 'turningPoint', data: { option } })
    },
  },
})

registerCodeHook({
  name: 'veteran',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || info.counteracting || !hasAbility(state, op, 'pf.a.veteran')) return []
      if (!state.effects.some((e) => e.kind === 'pf.aow' && e.seat === seat)) return []
      if (state.effects.some((e) => e.kind === 'pf.veteran' && e.operativeId === op.id)) return []
      return [{}]
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: 'pf.veteran', operativeId: info.subjectId, expires: 'activation' })
    },
  },
})

// ---------------------------------------------------------------------------
// MARKERLIGHT (T-PF.27, T-PF.28) with Kauyon, High-intensity Markerlight, Orbital Survey Uplink and Analyse
// ---------------------------------------------------------------------------

function visibleEnemies(s: GameState, op: Operative): Operative[] {
  return enemiesOf(s, op).filter((e) => e.wounds > 0 && visible(s, bodyOf(op), bodyOf(e)))
}

registerCodeHook({
  name: 'markerlight',
  action: {
    offers(state, op, def, act): OfferSeed[] {
      const counter = act?.counteract === true
      const kauyon = !counter && op.order === 'conceal' && doctrineFor(state, op) === 'kauyon'
      const cost = kauyon ? 0 : undefined
      const link = op.datacardId === 'pf.mb3-recon-drone' ? undefined : uniqueLink(state, op.id)
      const seeds: OfferSeed[] = []
      const seen = new Set<string>()
      for (const e of visibleEnemies(state, op)) {
        if (link && link.data?.targetId !== e.id) continue
        seen.add(e.id)
        seeds.push({ key: e.id, params: { targetId: e.id }, ...(cost !== undefined ? { cost } : {}) })
        const himl = state.players[op.seat].equipment.includes(HIML) && tpUsesOf(state, op.seat, HIML) < 2 && !hasAbility(state, op, 'pf.a.mv7-markerlight')
        if (himl) seeds.push({ key: `${e.id}:himl`, params: { targetId: e.id, param: 'himl' }, ...(cost !== undefined ? { cost } : {}), data: { variant: 'himl' } })
      }
      // Orbital Survey Uplink: any enemy in the killzone, seen or not
      if (state.players[op.seat].equipment.includes(OSU) && !usedThisTp(state, op.seat, OSU)) {
        for (const e of enemiesOf(state, op)) {
          if (e.wounds <= 0 || seen.has(e.id)) continue
          if (link && link.data?.targetId !== e.id) continue
          seeds.push({ key: `osu:${e.id}`, params: { targetId: e.id, param: 'osu' }, ...(cost !== undefined ? { cost } : {}), data: { variant: 'osu' } })
        }
      }
      void def
      return seeds
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const target = s.operatives[params.targetId as string]
      if (!target || target.status !== 'active' || target.seat === op.seat) {
        cancelAction(ctx)
        return
      }
      const mode = params.param as string | undefined
      const base = ((def.effect as { params?: { tokens?: number } } | undefined)?.params?.tokens as number | undefined) ?? 1
      let n = base
      if (hasAbility(s, op, 'pf.a.mv7-markerlight')) {
        n = 2
        markFired('mv7Markerlight')
      }
      if (mode === 'himl') {
        n = 2
        addTpUse(s, op.seat, HIML)
        markFired('highIntensityMarkerlight')
      } else if (mode === 'osu') {
        n = 1
        markUsedTp(s, op.seat, OSU)
        markFired('orbitalSurveyUplink')
      }
      addToken(ctx, target.id, { kind: ML, owner: op.seat, count: n, cap: ML_CAP }, 'markerlight')
      if (hasAbility(s, op, 'pf.a.analyse') && mode !== 'osu') {
        for (const e of enemiesOf(s, op)) {
          if (e.id === target.id || e.wounds <= 0) continue
          if (!isWithin(bodyOf(target), bodyOf(e), 3)) continue
          if (!visible(s, bodyOf(op), bodyOf(e))) continue
          addToken(ctx, e.id, { kind: ML, owner: op.seat, count: 1, cap: ML_CAP }, 'analyse')
          markFired('analyse')
        }
      }
      markFired('markerlightRules')
      // the Shoot / Markerlight link (T-PF.28): the MB3 and a counteraction are exempt
      const act = s.firefight.activation
      if (op.datacardId !== 'pf.mb3-recon-drone' && act && !act.counteract) {
        s.effects = s.effects.filter((e) => !(e.kind === 'pf.link' && e.operativeId === op.id))
        addEffect(ctx, { source: 'pf.link', seat: op.seat, kind: 'pf.link', operativeId: op.id, expires: 'activation', data: { targetId: target.id, from: 'markerlight' } })
      }
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// SIGNAL, SYSTEM JAM, MEDIKIT, PULSE ACCELERATOR, PHOTON GRENADE
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'pfSignal',
  action: {
    offers(state, op): OfferSeed[] {
      const range = 6 + commsBonus(state, op.seat, op)
      const out: OfferSeed[] = []
      for (const f of friendsOf(state, op)) {
        if (f.wounds <= 0 || !isPf(state, f)) continue
        if (distanceBetween(bodyOf(op), bodyOf(f)) > range + 1e-6) continue
        // "visible to this operative": the Comms Specialist must see the operative it signals
        if (!visible(state, bodyOf(op), bodyOf(f))) continue
        out.push({ key: f.id, params: { targetId: f.id } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!target || target.status !== 'active') {
        cancelAction(ctx)
        return
      }
      applyAplEffect(ctx, target.id, 1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'systemJam',
  action: {
    offers(state, op): OfferSeed[] {
      return visibleEnemies(state, op).map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!target || target.status !== 'active') {
        cancelAction(ctx)
        return
      }
      applyAplEffect(ctx, target.id, -1, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'medikit',
  action: {
    offers(state, op): OfferSeed[] {
      const out: OfferSeed[] = []
      for (const f of seatOpsActive(state, op.seat)) {
        if (!isPf(state, f) || isDrone(state, f) || f.wounds >= f.maxWounds) continue
        if (f.id !== op.id && !inControlRange(state, bodyOf(op), bodyOf(f))) continue
        if (usedThisTp(state, op.seat, `pf.medic.saved:${f.id}`)) continue
        out.push({ key: f.id, params: { targetId: f.id } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!target || target.status !== 'active') {
        cancelAction(ctx)
        return
      }
      const dice = ctx.roll('medikit.2d3', 2)
      const amount = dice.reduce((n, d) => n + Math.ceil(d / 2), 0)
      regainWounds(ctx, target.id, amount, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'pulseAccelerator',
  action: {
    offers(): OfferSeed[] {
      return [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      // one token on the drone itself; it goes when the drone next activates or is incapacitated
      addToken(ctx, op.id, { kind: PULSE, owner: op.seat, count: 1, cap: 1, sourceId: op.id, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'pulseAccelerator')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id }, op.seat)
      finishAction(ctx)
    },
  },
})

registerCodeHook({
  name: 'photonGrenade',
  action: {
    offers(state, op): OfferSeed[] {
      if (isDrone(state, op) || usedThisTp(state, op.seat, PHOTON_EQ)) return []
      const card = state.data.datacards[op.datacardId]
      if (!card?.uniqueActions.some((id) => id.startsWith('pf.a.markerlight'))) return []
      return visibleEnemies(state, op).map((e) => ({ key: e.id, params: { targetId: e.id } }))
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const target = s.operatives[params.targetId as string]
      if (!target || target.status !== 'active') {
        cancelAction(ctx)
        return
      }
      markUsedTp(s, op.seat, PHOTON_EQ)
      const [roll] = ctx.roll('photon.grenade', 1)
      if (roll! >= 3) addToken(ctx, target.id, { kind: PHOTON, owner: op.seat, count: 1, cap: 1, sourceId: op.id, expires: ['holderActivationEnd'] }, 'photonGrenade')
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: `${target.id}:${roll}` }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// REMOTE PILOT (T-PF.12): a delegated free action for a drone
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'remotePilot',
  action: {
    offers(state, op): OfferSeed[] {
      return seatOpsActive(state, op.seat)
        .filter((d) => isDrone(state, d) && d.id !== op.id)
        .map((d) => ({ key: d.id, params: { targetId: d.id } }))
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const drone = s.operatives[params.targetId as string]
      if (!drone || drone.status !== 'active') {
        cancelAction(ctx)
        return
      }
      // the same drone cannot take the same free action twice in this activation of the controller
      const deny = s.effects.filter((e) => e.kind === 'pf.rp' && e.operativeId === drone.id).map((e) => e.data?.action as string)
      const started = startDelegatedAction(ctx, {
        operativeId: drone.id,
        resume: 'pf.remotePilot',
        rules: { maxMove: 2, tag: 'remotePilot', deny },
        data: { controllerId: op.id, droneId: drone.id, abilityId: def.id },
      })
      if (!started) cancelAction(ctx)
    },
  },
})

registerFrameResume('pf.remotePilot', (ctx, outcome) => {
  if (outcome === 'finished') finishAction(ctx)
  else cancelAction(ctx)
})

// ---------------------------------------------------------------------------
// Grenadier Specialist (T-PF.9)
// ---------------------------------------------------------------------------

const GRENADES = ['core.w.frag-grenade', 'core.w.krak-grenade']

registerCodeHook({
  name: 'pfGrenadier',
  setup(ctx, seat) {
    // the Assault Grenadier carries frag and krak grenades of its own, apart from the team's equipment totals
    for (const op of Object.values(ctx.state.operatives)) {
      if (op.seat !== seat || !hasAbility(ctx.state, op, 'pf.a.grenadier-specialist')) continue
      for (const w of GRENADES) if (ctx.state.data.weapons[w] && !op.weapons.includes(w)) op.weapons.push(w)
    }
  },
})

// ---------------------------------------------------------------------------
// Medic! (T-PF.14)
// ---------------------------------------------------------------------------

// The operative "would be incapacitated": beforeIncapacitated checks the conditions at that moment and records the
// medic (MEDIC_ASK, which spends the turning point's use: declining spends it). The owner answers in the before-removal
// queue (the operative.incapacitated hook below); taking it keeps the operative (attack-common.saveFromRemoval).
// Removals outside an attack (mines, direct damage) wait for that queue through the provider's pausableRemoval.
const MEDIC_ASK = 'pf.medicAsk'

registerCodeHook({
  name: 'medic',
  /** 'save' / 'none': the owner's answer in the removal queue; 'dash': the free Dash after the action */
  choice(ctx, op, option, _context) {
    if (option === 'save' || option === 'none') {
      medicAnswer(ctx, op, option === 'save')
      return
    }
    const fx = effectFor(ctx.state, 'pf.medicDash', op.id)
    if (!fx) {
      reactionDone(ctx)
      return
    }
    removeEffects(ctx, (e) => e.id === fx.id)
    const started = startFreeAction(ctx, { operativeId: op.id, action: 'dash', endWithinCrOf: fx.data?.medicId as string, resume: REACTION_DONE })
    if (!started) reactionDone(ctx)
  },
})

function medicFor(s: GameState, victim: Operative): Operative | null {
  if (!isPf(s, victim) || isDrone(s, victim) || victim.status !== 'active') return null
  if (inEnemyCr(s, victim)) return null
  const a = s.attack
  for (const m of withAbility(s, victim.seat, 'pf.a.medic')) {
    if (m.id === victim.id || usedThisTp(s, m.seat, `pf.medic:${m.id}`)) continue
    if (distanceBetween(bodyOf(m), bodyOf(victim)) > 3 + 1e-6) continue
    if (!visible(s, bodyOf(m), bodyOf(victim))) continue
    if (inEnemyCr(s, m)) continue
    // in a Shoot action the medic must not be a primary or secondary target
    if (a?.kind === 'shoot' && a.targets.includes(m.id)) continue
    return m
  }
  return null
}

registerHook(
  'beforeIncapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !victim) return null
    const medic = medicFor(s, victim)
    if (!medic) return null
    // the first time each turning point: this moment is the one, whatever the owner answers
    markUsedTp(s, medic.seat, `pf.medic:${medic.id}`)
    const carrying = victim.flags.carrying
    addEffect(ctx, { source: 'pf.a.medic', seat: victim.seat, kind: MEDIC_ASK, operativeId: victim.id, expires: 'turningPoint', data: { medicId: medic.id, ...(carrying ? { carrying } : {}) } })
    return null
  },
  'pf.beforeIncapacitated',
)

// the owner's decision, before removal (R-5.18)
registerHook(
  'operative.incapacitated',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const victim = s && c.operativeId ? s.operatives[c.operativeId] : undefined
    if (!s || !ctx || !victim) return null
    const ask = effectFor(s, MEDIC_ASK, victim.id)
    if (!ask) return null
    const medic = s.operatives[String(ask.data?.medicId)]
    // only a queue can wait for the answer, and the medic must still be in the killzone
    if (!s.removal || !s.removal.ids.includes(victim.id) || s.pending || !medic || medic.status !== 'active') {
      removeEffects(ctx, (e) => e.id === ask.id)
      return null
    }
    ctx.raise({
      kind: 'ability.choice',
      seat: victim.seat,
      window: 'operative.incapacitated',
      context: { hook: 'medic', operativeId: victim.id, medicId: medic.id },
      options: [
        { id: 'save', labelKey: 'removal.free', type: 'ability.choice' as const, payload: { option: 'save' }, data: { name: `Medic! (${medic.name}): keep it in the fight on 1 wound`, medicId: medic.id } },
        { id: 'none', labelKey: 'removal.free', type: 'ability.choice' as const, payload: { option: 'none' }, data: { name: 'Let it fall' } },
      ],
    })
    return null
  },
  'pf.medicAsk',
)

function medicAnswer(ctx: Ctx, victim: Operative, use: boolean): void {
  const s = ctx.state
  const ask = effectFor(s, MEDIC_ASK, victim.id)
  const medic = ask ? s.operatives[String(ask.data?.medicId)] : undefined
  if (ask) removeEffects(ctx, (e) => e.id === ask.id)
  if (use && ask && medic && medic.status === 'active' && saveFromRemoval(ctx, victim.id, 1)) medicSaved(ctx, victim, medic, ask.data?.carrying as string | undefined)
  continueRemovals(ctx)
}

/** Medic! taken: 1 wound, the rest of the action safe, a free Dash after it, -1 APL for both (T-PF.14). */
function medicSaved(ctx: Ctx, victim: Operative, medic: Operative, carrying: string | undefined): void {
  const s = ctx.state
  markUsedTp(s, medic.seat, `pf.medic.saved:${victim.id}`)
  if (!victim.flags.injured && isInjured(victim)) {
    victim.flags.injured = true
    ctx.emit({ type: 'OperativeInjured', operativeId: victim.id })
  }
  // it was never incapacitated: a marker it carried (dropped by the shared before-removal step) is still its own
  const m = carrying ? s.markers.find((x) => x.id === carrying) : undefined
  if (m && !m.carriedBy && !victim.flags.carrying) {
    m.carriedBy = victim.id
    m.pos = { x: victim.pos.x, z: victim.pos.z }
    victim.flags.carrying = m.id
    ctx.emit({ type: 'MarkerPickedUp', markerId: m.id, operativeId: victim.id }, victim.seat)
  }
  const deferred = !!s.removal?.deferred
  // an attack's queue is still inside the action: nothing can incapacitate it for the rest of it
  if (!deferred) addEffect(ctx, { source: 'pf.a.medic', seat: victim.seat, kind: 'pf.medicFloor', operativeId: victim.id, expires: 'action' })
  // the activation the rule was used in: the one under a frame (an enemy Guard interrupt, a free action) counts
  const under = activeActivationOf(s)
  const own = !!under && !under.counteract && under.operativeId === victim.id
  if (own) {
    // used in its own activation: that activation ends once the action is done (no AP left to spend); a removal
    // outside an attack runs after the step, so the activation's waiting action choice keeps only End
    under.endsAfterAction = true
    const parked = s.removal?.parked
    if (deferred && parked?.kind === 'firefight.action' && s.firefight.activation === under && parked.options?.some((o) => o.id === 'end')) {
      s.removal!.parked = { ...parked, options: parked.options.filter((o) => o.id === 'end') }
    }
  }
  // the free Dash after the action: a reaction when the other player is active, a 0 CP offer in the
  // action-ended window when the Pathfinder player is (pfPloyRule.extraOffers)
  addEffect(ctx, { source: 'pf.a.medic', seat: victim.seat, kind: 'pf.medicDash', operativeId: victim.id, expires: 'activation', data: { medicId: medic.id } })
  // "until the end of its next activation": held over when used in the operative's own activation
  aplChangeNextActivation(ctx, victim.id, -1, 'pf.a.medic')
  aplChangeNextActivation(ctx, medic.id, -1, 'pf.a.medic')
  ctx.emit({ type: 'AbilityUsed', operativeId: medic.id, abilityId: 'pf.a.medic', detail: victim.id }, medic.seat)
  markFired('medic')
}

// ---------------------------------------------------------------------------
// Ploys
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'suppressingFire',
  ploy: {
    offers: () => [{}],
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

registerCodeHook({
  name: 'bonded',
  ploy: {
    offers: () => [{}],
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

registerCodeHook({
  name: 'takeCover',
  ploy: {
    offers: () => [{}],
    apply(ctx, seat, ploy) {
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', expires: 'turningPoint' })
    },
  },
})

// A WORTHY CAUSE: a free mission action for a non-drone Pathfinder, in the shared ploy window that opens as the
// Firefight phase starts (firefight.start; offered like a gambit, one offer per Pathfinder that has a mission action)
registerCodeHook({
  name: 'worthyCause',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const out: PloyOfferSeed[] = []
      const missions = missionActionIds(state).map((id) => state.data.abilities[id]).filter((d): d is RuntimeAbility => !!d)
      for (const op of seatOpsActive(state, seat)) {
        if (!isPf(state, op) || isDrone(state, op)) continue
        // a mission action it could take right now: its generic conditions hold and the action has a legal use
        const can = missions.some((def) => {
          if (!evalCondition(def.conditions as Condition | undefined, { state, seat, subjectId: op.id, actorId: op.id, activation: null })) return false
          const hook = getCodeHook(codeOf(def) ?? '')
          return (hook?.action?.offers(state, op, def, null).length ?? 0) > 0
        })
        if (can) out.push({ param: op.id, operativeId: op.id })
      }
      return out
    },
    apply(ctx, _seat, _ploy, seed) {
      const id = seed.param ?? seed.operativeId
      // nothing started: the ploy window simply carries on (ploys.ts handlePloy)
      if (id) startDelegatedAction(ctx, { operativeId: id, resume: 'pf.worthyCause', rules: { allow: ['mission'], tag: 'worthyCause' } })
    },
  },
})

// the free mission action is over: the firefight.start window (restored when the frame closed) carries on
registerFrameResume('pf.worthyCause', (ctx) => {
  if (ctx.state.window) continueWindow(ctx)
  else if (ctx.state.phase === 'strategy') resumeGambit(ctx)
})

// RECON SWEEP: a free Dash for each Pathfinder wholly within 6" of the chosen edge, in the order the player picks
registerCodeHook({
  name: 'reconSweep',
  ploy: {
    offers(state, seat): PloyOfferSeed[] {
      const own = ownEdge(state, seat)
      const mine = seatOpsActive(state, seat).filter((o) => isPf(state, o))
      return EDGES.filter((e) => e !== own && mine.some((o) => whollyWithinEdge(state, e, o, 6))).map((e) => ({ param: e }))
    },
    apply(ctx, seat, _ploy, seed) {
      const edge = seed.param as Edge
      const ids = seatOpsActive(ctx.state, seat)
        .filter((o) => isPf(ctx.state, o) && whollyWithinEdge(ctx.state, edge, o, 6))
        .map((o) => o.id)
      sweepNext(ctx, seat, edge, ids)
    },
  },
  choice(ctx, _op, option, context) {
    const seat = context.seat as Seat
    const edge = context.edge as Edge
    const remaining = (context.remaining as string[]).slice()
    if (option === 'done') {
      resumeGambit(ctx)
      return
    }
    const rest = remaining.filter((id) => id !== option)
    const started = startFreeAction(ctx, { operativeId: option, action: 'dash', resume: 'pf.reconSweep', data: { seat, edge, remaining: rest, reconEdge: edge } })
    if (!started) sweepNext(ctx, seat, edge, rest)
  },
})

function sweepNext(ctx: Ctx, seat: Seat, edge: Edge, remaining: string[]): void {
  const s = ctx.state
  const live = remaining.filter((id) => {
    const o = s.operatives[id]
    return !!o && o.status === 'active' && enemiesInControlRange(s, o, o.seat).length === 0
  })
  if (live.length === 0) {
    resumeGambit(ctx)
    return
  }
  ctx.raise({
    kind: 'ability.choice',
    seat,
    window: 'strategy.gambit',
    context: { hook: 'reconSweep', operativeId: live[0], seat, edge, remaining: live },
    options: [
      ...live.map((id) => ({ id, labelKey: 'pf.reconSweep.dash', type: 'ability.choice' as const, payload: { option: id }, data: { name: s.operatives[id]!.name } })),
      { id: 'done', labelKey: 'pf.reconSweep.done', type: 'ability.choice' as const, payload: { option: 'done' } },
    ],
  })
}

registerFrameResume('pf.reconSweep', (ctx, _outcome, data) => {
  sweepNext(ctx, data.seat as Seat, data.edge as Edge, (data.remaining as string[]) ?? [])
})

// SUPPORTING FIRE: extra targets within 6" even with friendly Pathfinders in their control range
registerCodeHook({
  name: 'supportingFire',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || !isPf(state, op) || info.action !== 'shoot' || state.players[seat].cp < 1) return []
      for (const w of op.weapons) {
        if (state.data.weapons[w]?.type !== 'ranged') continue
        if (supportTargets(state, op, w).length > 0) return [{}]
      }
      return []
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'action' })
    },
  },
})

/** Enemies within 6" of the shooter that only the friendly Pathfinders in their control range keep from being chosen. */
function supportTargets(s: GameState, shooter: Operative, weaponId: string): string[] {
  const rules = ruleSetFor(s, shooter, weaponId, 'shoot')
  const out: string[] = []
  for (const e of enemiesOf(s, shooter)) {
    if (e.wounds <= 0 || !isWithin(bodyOf(shooter), bodyOf(e), 6)) continue
    if (rules.range !== null && !isWithin(bodyOf(shooter), bodyOf(e), rules.range)) continue
    const blockers = enemiesInControlRange(s, e, e.seat)
    if (blockers.length === 0 || blockers.some((b) => b.seat !== shooter.seat || b.id === shooter.id)) continue
    const info = targetInfo(s, shooter, e, rules)
    if (!info.verdict.visible || info.coverBlocks) continue
    out.push(e.id)
  }
  return out
}

// SAVIOUR PROTOCOLS: a drone takes the shot instead (T-PF.37)
registerCodeHook({
  name: 'saviourProtocols',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const a = state.attack
      const target = info.targetId ? state.operatives[info.targetId] : undefined
      const attacker = info.attackerId ? state.operatives[info.attackerId] : undefined
      if (!a || a.kind !== 'shoot' || !a.weaponId || !target || !attacker || info.kind !== 'shoot') return []
      if (target.seat !== seat || info.subjectId !== target.id || !isPf(state, target) || isDrone(state, target)) return []
      const weapon = state.data.weapons[a.weaponId]
      if (!weapon) return []
      const rules = parseRules(effectiveRules(state, attacker, weapon, 'shoot', target.id))
      if (rules.blast !== null || rules.torrent !== null) return []
      return seatOpsActive(state, seat)
        .filter((d) => isDrone(state, d) && isPf(state, d) && d.id !== target.id)
        .filter((d) => isWithin(bodyOf(target), bodyOf(d), 3) && visible(state, bodyOf(target), bodyOf(d)))
        .map((d) => ({ param: d.id, operativeId: d.id }))
    },
    apply(ctx, _seat, _ploy, seed) {
      const s = ctx.state
      const a = s.attack
      const drone = seed.param ? s.operatives[seed.param] : undefined
      if (!a || !a.weaponId || !drone) return
      const attacker = s.operatives[a.operativeId]!
      const rules = ruleSetFor(s, attacker, a.weaponId, 'shoot', drone.id, ctx)
      const own = targetInfo(s, attacker, drone, rules)
      const was = a.status ?? { cover: false, obscured: false, improvedCover: false }
      // the drone is in cover or obscured only if the original target was (and its own position allows it)
      redirectAttack(ctx, drone.id, { cover: was.cover && own.inCover, obscured: was.obscured && own.obscured, improvedCover: was.improvedCover && own.improvedCover })
      ctx.emit({ type: 'AbilityUsed', operativeId: drone.id, abilityId: 'pf.p.saviour-protocols', detail: a.targets[a.index] ?? '' }, drone.seat)
    },
  },
})

function droneControllerActive(s: GameState, seat: Seat): boolean {
  return withAbility(s, seat, 'pf.a.drone-controller').length > 0
}

const pfPloyRule = {
  extraOffers(state: GameState, seat: Seat, window: string, info: { subjectId?: string; action?: string }): PloyOffer[] {
    // Medic!'s free Dash once the action is over, while the Pathfinder player is the active one (T-PF.14); when
    // the opponent is active the reaction offer below carries it instead
    if (window === 'firefight.actionEnded') {
      const act = state.firefight.activation
      if (!act || act.seat !== seat) return []
      return state.effects
        .filter((e) => e.kind === 'pf.medicDash' && e.seat === seat && !!e.operativeId && state.operatives[e.operativeId]?.status === 'active')
        .map((e) => ({ id: `pf.medicDash@${e.operativeId}`, ployId: 'pf.medicDash', name: 'Medic! free Dash', cost: 0, via: 'pf.medicDash', seed: { param: e.operativeId! }, operativeId: e.operativeId! }))
    }
    // Target Analysis Optic: once per TP as a friendly non-drone Pathfinder declares a Shoot (T-PF.39)
    if (window !== 'firefight.actionDeclared' || info.action !== 'shoot') return []
    const op = info.subjectId ? state.operatives[info.subjectId] : undefined
    if (!op || op.seat !== seat || !isPf(state, op) || isDrone(state, op)) return []
    if (!state.players[seat].equipment.includes(TAO) || usedThisTp(state, seat, TAO)) return []
    if (state.effects.some((e) => e.source === TAO && e.operativeId === op.id)) return []
    return [{ id: TAO, ployId: TAO, name: 'Target Analysis Optic', cost: 0, via: 'pf.tao', seed: {}, operativeId: op.id }]
  },
  costAdjust(state: GameState, seat: Seat, ploy: { id: string }, seed: { param?: string }) {
    if (ploy.id !== SAVIOUR) return null
    if (droneControllerActive(state, seat)) return { cost: 0, via: 'pf.sp.controller' }
    const d = seed.param ? state.operatives[seed.param] : undefined
    if (d && hasAbility(state, d, 'pf.a.shield-generator')) return { cost: 0, via: 'pf.sp.shield' }
    return null
  },
  onUsed(ctx: Ctx, seat: Seat, offer: PloyOffer, info: { subjectId?: string }) {
    if (offer.via === 'pf.medicDash') {
      const id = offer.operativeId
      const fx = id ? effectFor(ctx.state, 'pf.medicDash', id) : undefined
      if (!id || !fx) return
      removeEffects(ctx, (e) => e.id === fx.id)
      startFreeAction(ctx, { operativeId: id, action: 'dash', endWithinCrOf: fx.data?.medicId as string, resume: 'ploy.freeAction' })
      return
    }
    if (offer.via === 'pf.tao') {
      const id = offer.operativeId ?? info.subjectId
      if (id) addEffect(ctx, { source: TAO, seat, kind: 'equipment', operativeId: id, expires: 'action' })
      markFired('targetAnalysisOptic')
    } else if (offer.via === 'pf.sp.controller') markFired('droneController')
    else if (offer.via === 'pf.sp.shield') markFired('shieldGenerator')
  },
}

// Registered at module load (ploy-rules.ts is a leaf, so there is no import-cycle problem); the code hook stays as
// the name the Shas'ui's Art of War record gives the team rules.
registerPloyRule(pfPloyRule)
registerCodeHook({ name: 'pfTeamRules', setup: () => undefined })

// POINT-BLANK FUSILLADE (T-PF.38): offered in the fight.weaponsSelected window to the retaliating Pathfinder
function activeActivationOf(s: GameState): Activation | null {
  const cur = s.firefight.activation
  if (!cur) return null
  return cur.frame ? ((s.firefight.stack ?? []).at(-1) ?? null) : cur
}

function notEngagedAtStart(s: GameState, attacker: Operative, retaliator: Operative): boolean {
  const act = activeActivationOf(s)
  if (!act || act.operativeId !== attacker.id) return false
  if (act.counteract) return act.performed.includes('charge')
  return s.ledger[retaliator.seat].uses[`pf.cr:${retaliator.id}`] === 0
}

registerCodeHook({
  name: 'pointBlankFusillade',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const a = state.attack
      if (!a || a.kind !== 'fight' || !a.fight) return []
      const ret = state.operatives[a.fight.targetId]
      const attacker = state.operatives[a.operativeId]
      if (!ret || !attacker || ret.seat !== seat || info.subjectId !== ret.id || !isPf(state, ret) || isDrone(state, ret)) return []
      if (ret.flags.cannotRetaliate || !notEngagedAtStart(state, attacker, ret)) return []
      return ret.weapons
        .filter((w) => state.data.weapons[w]?.type === 'ranged' && !(state.data.weapons[w]?.name ?? '').toLowerCase().includes('grenade'))
        .map((w) => ({ param: w }))
    },
    apply(ctx, seat, ploy, seed) {
      const a = ctx.state.attack
      if (!a?.fight || !seed.param) return
      const ret = ctx.state.operatives[a.fight.targetId]!
      a.fight.weaponD = seed.param
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: ret.id, expires: 'action', data: { weaponId: seed.param } })
    },
  },
})

// ---------------------------------------------------------------------------
// Passive rules that live in hooks
// ---------------------------------------------------------------------------

function opOfHook(c: HookContext): Operative | undefined {
  return c.state && c.operativeId ? c.state.operatives[c.operativeId] : undefined
}

function nearbyFriendNonDrone(s: GameState, op: Operative, inches: number): boolean {
  return seatOpsActive(s, op.seat).some((f) => f.id !== op.id && isPf(s, f) && !isDrone(s, f) && isWithin(bodyOf(op), bodyOf(f), inches))
}

function pulseAcceleratorNear(s: GameState, op: Operative): boolean {
  for (const d of seatOpsActive(s, op.seat)) {
    if (d.id === op.id || !hasToken(s, d.id, PULSE, op.seat)) continue
    if (isWithin(bodyOf(op), bodyOf(d), 3)) return true
  }
  return false
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    const weapon = s.data.weapons[c.weaponId]
    if (!weapon) return null
    const target = data.targetId ? s.operatives[data.targetId] : undefined
    // --- Shield Generator: weapons used against the MV4 lose Piercing and Piercing Crits (T-PF.22)
    if (target && data.kind === 'shoot' && hasAbility(s, target, 'pf.a.shield-generator') && data.rules.some((r) => r.rule === 'piercing')) {
      for (let i = data.rules.length - 1; i >= 0; i--) if (data.rules[i]!.rule === 'piercing') data.rules.splice(i, 1)
      markFired('shieldGenerator')
    }
    if (!isPf(s, op)) return null
    // --- Point-Blank Fusillade: Devastating, Piercing and Torrent do nothing on the retaliating weapon (T-PF.38)
    const pbf = data.kind === 'fight' && s.effects.some((e) => e.source === PBF && e.operativeId === op.id && e.data?.weaponId === c.weaponId)
    if (pbf) {
      for (let i = data.rules.length - 1; i >= 0; i--) if (['devastating', 'piercing', 'torrent'].includes(data.rules[i]!.rule)) data.rules.splice(i, 1)
    }
    // --- BONDED: Accurate 1 while shooting, or retaliating with a ranged weapon, near another non-drone Pathfinder
    if (ployEffect(s, BONDED, op.seat) && !isDrone(s, op) && weapon.type === 'ranged' && (data.kind === 'shoot' || pbf) && nearbyFriendNonDrone(s, op, 3)) {
      data.rules.push({ rule: 'accurate', x: 1 })
      markFired('bonded')
    }
    if (data.kind !== 'shoot') return null
    // --- Pulse Accelerator: Lethal 5+ and Severe on pulse weapons within 3" of a charged MV31 (T-PF.24)
    if (isPulseWeapon(s, c.weaponId) && pulseAcceleratorNear(s, op)) {
      data.rules.push({ rule: 'lethal', target: 5 }, { rule: 'severe' })
      markFired('pulseAccelerator')
    }
    // --- Markerlight benefits keyed on the target's tokens (T-PF.30)
    if (target && benefitWeapon(s, op, c.weaponId)) {
      const n = effectiveTokens(s, op, target.id)
      if (n >= 1) {
        for (const r of ['saturate', 'balanced']) if (!hasRef(data.rules, r)) data.rules.push({ rule: r })
        if (n >= 4 && !hasRef(data.rules, 'seek-light')) data.rules.push({ rule: 'seek-light' })
        if (n >= 5 && !hasRef(data.rules, 'seek')) data.rules.push({ rule: 'seek' })
        markFired('markerlightRules')
      }
    }
    return null
  },
  'pf.modifyWeaponRules',
)

registerHook(
  'modifyAttackDice',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; hitDelta: number }
    const weapon = s.data.weapons[c.weaponId]
    if (!weapon) return null
    // --- Inertial Dampener: Hit penalties on the marksman rail rifle are ignored, improvements stay (T-PF.13)
    if (weapon.profileGroup === MARKSMAN_GROUP && hasAbility(s, op, 'pf.a.inertial-dampener')) {
      const worsen = (hasInjuredPenalty(op) ? 1 : 0) + (s.attack?.pointBlank && s.attack.operativeId === op.id ? 1 : 0)
      if (worsen > 0 && data.hitDelta > 0) {
        data.hitDelta = Math.max(data.hitDelta - worsen, Math.min(data.hitDelta, 0))
        markFired('inertialDampener')
      }
    }
    // --- Markerlight row 2: Hit improved by 1, never better than 3+ (T-PF.30)
    if (data.kind === 'shoot' && c.targetId && benefitWeapon(s, op, c.weaponId)) {
      const n = effectiveTokens(s, op, c.targetId)
      if (n >= 2 && weapon.hit + data.hitDelta > 3) {
        data.hitDelta = Math.max(data.hitDelta - 1, 3 - weapon.hit)
        markFired('markerlightRules')
      }
    }
    // --- Grav-inhibitor: enemy melee Hit worse by 1 within 6" of a visible MV33 (T-PF.26)
    if (data.kind === 'fight' && weapon.type === 'melee' && graviticNear(s, op)) {
      data.hitDelta += 1
      markFired('gravInhibitor')
    }
    return null
  },
  'pf.modifyAttackDice',
)

/** Is the operative visible to and within 6" of an enemy MV33 Grav-inhibitor Drone? */
function graviticNear(s: GameState, op: Operative): boolean {
  for (const d of enemiesOf(s, op)) {
    if (d.wounds <= 0 || !hasAbility(s, d, 'pf.a.grav-inhibitor')) continue
    if (isWithin(bodyOf(d), bodyOf(op), 6) && visible(s, bodyOf(d), bodyOf(op))) return true
  }
  return false
}

registerHook(
  'modifyDefenceDice',
  (c) => {
    const s = c.state
    const target = opOfHook(c)
    if (!s || !target || !c.weaponId || !c.targetId) return null
    // --- TAKE COVER: Save improved by 1 when a cover save can be retained (T-PF.34)
    if (!isPf(s, target) || !ployEffect(s, TAKE_COVER, target.seat)) return null
    const shooter = s.operatives[c.targetId]
    if (!shooter) return null
    const seq = s.attack?.seq
    const rules = parseRules(effectiveRules(s, shooter, s.data.weapons[c.weaponId]!, 'shoot', target.id))
    const inCover = seq ? seq.cover : targetInfo(s, shooter, target, rules).inCover
    if (!inCover || rules.saturate) return null
    ;(c.data as { saveDelta: number }).saveDelta -= 1
    markFired('takeCover')
    return null
  },
  'pf.modifyDefenceDice',
)

registerHook(
  'target.status',
  (c) => {
    const s = c.state
    const shooter = opOfHook(c)
    if (!s || !shooter || !c.targetId) return null
    const data = c.data as { obscured: boolean; inCover: boolean }
    if (!data.obscured || !isPf(s, shooter)) return null
    // --- Multi-Dimensional Vision: enemies cannot be obscured while this operative shoots (T-PF.19)
    if (hasAbility(s, shooter, 'pf.a.multi-dimensional-vision')) {
      data.obscured = false
      markFired('multiDimensionalVision')
      return null
    }
    // --- Markerlight row 3: the target cannot be obscured (T-PF.30)
    const a = s.attack
    const weaponId = a && a.operativeId === shooter.id ? a.weaponId : null
    if ((weaponId === null || benefitWeapon(s, shooter, weaponId)) && effectiveTokens(s, shooter, c.targetId) >= 3) {
      data.obscured = false
      markFired('markerlightRules')
    }
    return null
  },
  'pf.target.status',
)

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const s = c.state
    const shooter = opOfHook(c)
    if (!s || !shooter || !isPf(s, shooter)) return null
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    const a = s.attack
    if (a?.pointBlank) return null
    // --- Seek Light / Seek from 4 or 5 tokens make more targets valid (T-PF.30)
    if (benefitWeapon(s, shooter, data.weaponId)) {
      const base = ruleSetFor(s, shooter, data.weaponId, 'shoot', undefined, c.engine)
      for (const e of enemiesOf(s, shooter)) {
        if (e.wounds <= 0 || data.candidates.includes(e.id)) continue
        const n = effectiveTokens(s, shooter, e.id)
        if (n < 4) continue
        const rules = { ...base, seekLight: base.seekLight || n >= 4, seek: base.seek || n >= 5 }
        if (rules.range !== null && !isWithin(bodyOf(shooter), bodyOf(e), rules.range)) continue
        if (enemiesInControlRange(s, e, e.seat).length > 0) continue
        const info = targetInfo(s, shooter, e, rules)
        if (!info.verdict.visible || info.coverBlocks) continue
        data.candidates.push(e.id)
        markFired('markerlightRules')
      }
    }
    // --- SUPPORTING FIRE: targets within 6" despite friendly Pathfinders in their control range (T-PF.36)
    if (!data.secondary && s.effects.some((e) => e.source === SUPPORTING && e.operativeId === shooter.id)) {
      for (const id of supportTargets(s, shooter, data.weaponId)) if (!data.candidates.includes(id)) data.candidates.push(id)
    }
    // --- the Shoot / Markerlight link (T-PF.28): a Guard shot is not linked
    const link = uniqueLink(s, shooter.id)
    const cur = s.firefight.activation
    if (link && !data.secondary && !(cur?.frame?.kind === 'interrupt')) {
      const only = link.data?.targetId as string
      data.candidates.splice(0, data.candidates.length, ...data.candidates.filter((id) => id === only))
    }
    return null
  },
  'pf.beforeShootTargetSelect',
)

registerHook(
  'afterShootResolved',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = opOfHook(c)
    if (!s || !ctx || !op) return null
    const data = c.data as { weaponId: string | null; targets: string[] }
    // Target Analysis Optic is spent once its Shoot resolves (a cancelled Shoot does not spend it)
    if (s.effects.some((e) => e.source === TAO && e.operativeId === op.id)) markUsedTp(s, op.seat, TAO)
    // the Grenadier's own frag or krak grenade is used up (T-PF.9)
    if (data.weaponId && GRENADES.includes(data.weaponId) && hasAbility(s, op, 'pf.a.grenadier-specialist') && !s.players[op.seat].equipment.includes('core.e.explosive-grenades')) {
      op.weapons = op.weapons.filter((w) => w !== data.weaponId)
      markFired('pfGrenadier')
    }
    // the Shoot / Markerlight link: a Guard shot and a counteraction are not linked, the MB3 is exempt
    const cur = s.firefight.activation
    if (!isPf(s, op) || op.datacardId === 'pf.mb3-recon-drone' || !cur || cur.counteract || cur.frame?.kind === 'interrupt') return null
    const first = data.targets[0]
    if (first && !uniqueLink(s, op.id)) {
      addEffect(ctx, { source: 'pf.link', seat: op.seat, kind: 'pf.link', operativeId: op.id, expires: 'activation', data: { targetId: first, from: 'shoot' } })
    }
    return null
  },
  'pf.afterShootResolved',
)

registerHook(
  'onDamageInflicted',
  (c) => {
    const s = c.state
    const op = opOfHook(c)
    if (!s || !op) return null
    const data = c.data as { source: string; amount: number }
    // Medic!: cannot be incapacitated for the remainder of the action (T-PF.14)
    if (data.amount > 0 && s.effects.some((e) => e.kind === 'pf.medicFloor' && e.operativeId === op.id)) {
      data.amount = Math.max(0, Math.min(data.amount, op.wounds - 1))
    }
    // Shield Generator: once per TP ignore the damage of one Normal Dmg attack die (T-PF.22)
    if ((data.source === 'normal' || data.source === 'strike-normal') && data.amount > 0 && hasAbility(s, op, 'pf.a.shield-generator')) {
      const key = `pf.shield:${op.id}`
      if (!usedThisTp(s, op.seat, key)) {
        markUsedTp(s, op.seat, key)
        data.amount = 0
        markFired('shieldGenerator')
        c.engine?.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: 'pf.a.shield-generator' }, op.seat)
      }
    }
    return null
  },
  'pf.onDamageInflicted',
)

registerHook(
  'activation.start',
  (c) => {
    const s = c.state
    if (!s) return null
    // who stood in an enemy control range when this activation began (Point-Blank Fusillade, T-PF.38)
    for (const o of activeOps(s)) {
      if (isPf(s, o)) s.ledger[o.seat].uses[`pf.cr:${o.id}`] = enemiesInControlRange(s, o, o.seat).length > 0 ? 1 : 0
    }
    return null
  },
  'pf.activation.start',
)

const MOVE_ACTIONS = ['dash', 'charge', 'fallBack', 'reposition']

registerHook(
  'action.ended',
  (c) => {
    const s = c.state
    const ctx = c.engine
    const op = opOfHook(c)
    if (!s || !ctx || !op) return null
    const data = c.data as { action: string; counteract: boolean }
    const cur = s.firefight.activation
    // --- Markerlight decay (T-PF.29): once per own activation, on Dash, Charge, Fall Back or Reposition
    const treated = cur?.declared?.params?.treatedAs
    const moved = MOVE_ACTIONS.includes(data.action) || (typeof treated === 'string' && MOVE_ACTIONS.includes(treated))
    if (moved && cur && tokenCount(s, op.id, ML, otherSeat(op.seat)) > 0) {
      const underlying = cur.frame ? ((s.firefight.stack ?? []).at(-1) ?? null) : cur
      const own = !!underlying && underlying.operativeId === op.id && !underlying.counteract
      if (own && !s.effects.some((e) => e.kind === 'pf.decayed' && e.operativeId === op.id)) {
        removeToken(ctx, op.id, ML, 'decay', otherSeat(op.seat), 1)
        addEffect(ctx, { source: 'pf.markerlightRules', seat: otherSeat(op.seat), kind: 'pf.decayed', operativeId: op.id, expires: 'activation' })
        markFired('markerlightRules')
      }
    }
    // --- Remote Pilot: remember what the drone did, and let the controller repeat the action (T-PF.12)
    const delegated = cur?.frame?.data?.delegated as { tag?: string } | undefined
    if (cur?.frame && delegated?.tag === 'remotePilot' && cur.operativeId === op.id) {
      addEffect(ctx, { source: 'pf.a.remote-pilot', seat: op.seat, kind: 'pf.rp', operativeId: op.id, expires: 'activation', data: { action: data.action } })
    }
    if (data.action === 'ability:pf.a.remote-pilot' && cur) {
      const i = cur.performed.lastIndexOf(data.action)
      if (i >= 0) cur.performed.splice(i, 1)
    }
    return null
  },
  'pf.action.ended',
)

// ---------------------------------------------------------------------------
// The team rule provider
// ---------------------------------------------------------------------------

/** Drone rule: action ids the datacard allows, in the engine's spelling (universal ids and `ability:<id>`). */
function droneAllows(s: GameState, op: Operative, actionId: string): boolean {
  const p = codeParams(s, op, 'pfDrone')
  if (!p) return true
  const allowed = ((p.allowedActions as string[] | undefined) ?? []).map((a) => (a.startsWith('pf.a.') ? `ability:${a}` : normAction(a)))
  return allowed.includes(actionId)
}

function remotePilotFrame(s: GameState, op: Operative): boolean {
  const act = s.firefight.activation
  const d = act?.frame?.data?.delegated as { tag?: string } | undefined
  return !!act && act.operativeId === op.id && d?.tag === 'remotePilot'
}

function mapEdgeZoneProblem(s: GameState, op: Operative, points: Vec3[]): boolean {
  const act = s.firefight.activation
  const edge = act?.frame?.data?.reconEdge as Edge | undefined
  if (!edge || !act || act.operativeId !== op.id || points.length === 0) return false
  const end = points[points.length - 1]!
  const own = ownEdge(s, op.seat)
  const ghost = { pos: end, baseRadius: op.baseRadius }
  return !EDGES.some((e) => e !== own && whollyWithinEdge(s, e, ghost, 6))
}

registerTeamRules({
  id: TEAM_ID,

  actionForbidden(state, op, actionId) {
    if (actionId === 'dash' && hasToken(state, op.id, PHOTON)) return `${op.name} cannot Dash (Photon Grenade)`
    if (isDrone(state, op) && isPf(state, op) && !remotePilotFrame(state, op) && !droneAllows(state, op, actionId)) {
      markFired('pfDrone')
      return `${op.name} is a Drone and cannot take ${actionId}`
    }
    return null
  },

  /** a drone cannot Pick Up or Place a marker either: priced out of reach unless Remote Pilot lifts the rule */
  actionCostDelta(state, op, actionId) {
    if ((actionId === 'marker:pickUp' || actionId === 'marker:place') && isDrone(state, op) && !remotePilotFrame(state, op)) return 99
    return 0
  },

  controlApl(state, op, _marker, apl) {
    if (!isDrone(state, op) || !isPf(state, op)) return null
    markFired('pfDrone')
    return Math.max(0, apl - 1)
  },

  moveDelta(state, op) {
    let d = 0
    if (isPf(state, op)) {
      if (doctrineFor(state, op) === 'montka') d += 1
      if (isDrone(state, op) && droneControllerActive(state, op.seat)) {
        d += 2
        markFired('droneController')
      }
    }
    // Photon Grenade: -2" (Move never drops below 4", handled by effectiveMove)
    if (hasToken(state, op.id, PHOTON)) d -= 2
    return d
  },

  equipmentEligible(state, op) {
    return isPf(state, op) && isDrone(state, op) ? false : null
  },

  chainActivation(state, expended, wasChained) {
    if (wasChained || !codeParams(state, expended, 'groupActivation')) return null
    const ids = seatOpsActive(state, expended.seat)
      .filter((o) => o.id !== expended.id && hasKeyword(state, o, "SHAS'LA"))
      .map((o) => o.id)
    if (ids.length > 0) markFired('groupActivation')
    return ids
  },

  rerollsBanned(state, side: DiceSide, attack: AttackState) {
    if (attack.kind !== 'shoot' || side.operativeId !== attack.operativeId || !attack.weaponId) return false
    const fx = state.effects.some((e) => e.source === SUPPRESS && e.seat !== side.seat)
    if (!fx) return false
    const shooter = state.operatives[attack.operativeId]
    const primary = attack.targets[0] ? state.operatives[attack.targets[0]] : undefined
    if (!shooter || !primary) return false
    const rules = ruleSetFor(state, shooter, attack.weaponId, 'shoot', primary.id)
    const d = distanceBetween(bodyOf(shooter), bodyOf(primary))
    for (const t of validTargets(state, shooter, attack.weaponId)) {
      if (t.id === primary.id) continue
      const other = state.operatives[t.id]
      if (!other || !isPf(state, other) || other.seat === shooter.seat) continue
      // friendly Pathfinders with a Conceal order, or obscured from the shooter, are ignored
      if (other.order === 'conceal' || targetInfo(state, shooter, other, rules).obscured) continue
      if (distanceBetween(bodyOf(shooter), bodyOf(other)) < d - 1e-6) {
        markFired('suppressingFire')
        return true
      }
    }
    return false
  },

  fightResolveStart(state, attack) {
    const f = attack.fight
    if (!f) return null
    const fx = state.effects.find((e) => e.source === PBF && e.operativeId === f.targetId)
    const ret = state.operatives[f.targetId]
    if (!fx || !ret) return null
    markFired('pointBlankFusillade')
    const out: { first?: Seat; noBlock: Seat[] } = { noBlock: [ret.seat] }
    const weaponId = fx.data?.weaponId as string
    if (ret.ready && ret.order === 'engage' && isPulseWeapon(state, weaponId)) out.first = ret.seat
    return out
  },

  // Medic!: a removal outside an attack waits for the before-removal queue, where the owner may take it
  pausableRemoval: (state, op) => state.effects.some((e) => e.kind === MEDIC_ASK && e.operativeId === op.id),

  reactions(state, seat) {
    const out: ReactionOffer[] = []
    for (const e of state.effects) {
      if (e.kind !== 'pf.medicDash' || e.seat !== seat || !e.operativeId) continue
      const v = state.operatives[e.operativeId]
      if (!v || v.status !== 'active') continue
      out.push({ hook: 'medic', operativeId: v.id, option: 'dash', labelKey: 'pf.medicDash', data: { medicId: e.data?.medicId } })
    }
    return out
  },

  moveSurcharge(state, op, kind, points, breakdown) {
    let extra = 0
    // RECON SWEEP: the free Dash must end wholly within 6" of an edge that is not the player's own; a move that
    // does not is priced out of reach, so the player has to pick another end point (or decline the Dash)
    if (mapEdgeZoneProblem(state, op, points)) extra += 999
    if (kind === 'dash' || points.length === 0) return extra
    // Grav-inhibitor: +2" once, at the first point visible to and within 6" of an enemy MV33, and the extra
    // Obstructing and Accessible cost of the action is cancelled (T-PF.25)
    const drones = enemiesOf(state, op).filter((d) => d.wounds > 0 && hasAbility(state, d, 'pf.a.grav-inhibitor'))
    if (drones.length === 0) return extra
    let from: Vec3 = op.pos
    const samples: Vec3[] = []
    for (const p of points) {
      const len = Math.hypot(p.x - from.x, p.z - from.z)
      const n = Math.max(1, Math.ceil(len / 0.5))
      for (let k = 1; k <= n; k++) samples.push({ x: from.x + ((p.x - from.x) * k) / n, y: p.y, z: from.z + ((p.z - from.z) * k) / n })
      from = p
    }
    for (const pt of samples) {
      const ghost = { id: op.id, pos: pt, baseRadius: op.baseRadius, height: op.height }
      for (const d of drones) {
        if (!isWithin(bodyOf(d), ghost, 6)) continue
        if (!visible(state, bodyOf(d), ghost)) continue
        markFired('gravInhibitor')
        return extra + 2 - breakdown.accessible
      }
    }
    return extra
  },
})

