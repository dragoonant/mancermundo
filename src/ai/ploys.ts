// Ploys and re-rolls (docs/spec/40-ai section 2): Command Re-roll when a die is worth the point, strategic gambits
// from a per-ploy table, firefight ploys by per-ploy heuristics. Unknown ploys get a modest default score and are used
// only with spare command points. Never spends the last point on a marginal gain.
import { autoBlock } from '@/engine/attack-common'
import { dieOdds } from '@/engine/dice'
import { answerDecision } from '@/engine/query'
import { hasKeyword } from '@/engine/conditions'
import { enemiesOf, seatOps } from '@/engine/state'
import { distanceBetween } from '@/engine/measure'
import { bodyOf } from '@/engine/los'
import { tokenCount as gmTokenCount } from '@/engine/tokens'
import type { Action, DecisionOption, GameState, Operative } from '@/engine'
import type { AiCtx } from './tiers'
import { withOrder } from './eval'
import { threatAt } from './threat'
import { passAction } from './random'

// ---------------------------------------------------------------------------
// Command Re-roll
// ---------------------------------------------------------------------------

function threshold(cp: number): number {
  return cp >= 3 ? 1.0 : cp === 2 ? 1.6 : 2.4
}

function avgDmg(d: { normal: number; crit: number }): number {
  return d.normal * 0.75 + d.crit * 0.25
}

function countKinds(kinds: unknown): { normal: number; crit: number; fail: number } {
  const out = { normal: 0, crit: 0, fail: 0 }
  if (Array.isArray(kinds)) for (const k of kinds as unknown[]) if (k === 'normal' || k === 'crit' || k === 'fail') out[k as 'normal' | 'crit' | 'fail']++
  return out
}

/** Expected wounds gained by re-rolling one failed die in the open window; null when the window is not understood. */
function rerollGain(ctx: AiCtx, kindsOwn: unknown, side: string): number | null {
  const view = ctx.view
  const a = view.attack
  const seq = a?.seq
  if (!a || !seq) return null
  const own = countKinds(kindsOwn)
  if (own.fail === 0) return 0
  if (a.kind === 'shoot') {
    const target = view.operatives[seq.targetId]
    const atkOp = view.operatives[a.operativeId]
    const w = a.weaponId ? view.data.weapons[a.weaponId] : undefined
    if (!target || !atkOp || !w) return null
    const dmg = avgDmg(w.dmg)
    const defSucc = 3 * (1 - dieOdds(target.save).fail) + (seq.cover ? 0.5 : 0)
    if (side === 'attack') {
      const p = 1 - dieOdds(seq.atk.need, seq.atk.lethal ?? undefined).fail
      const k = own.normal + own.crit
      const leverage = Math.max(0.15, Math.min(1, (k - defSucc + 1.5) / 2))
      let gain = p * dmg * leverage
      // a single die that can finish the target
      if (target.wounds <= (k + 1) * dmg && target.wounds > k * dmg * 0.8) gain += p * 1.5
      return gain
    }
    const attacks = seq.atk.dice.filter((d) => d.kind !== 'fail')
    const q = 1 - dieOdds(target.save).fail
    const leverage = Math.max(0.1, Math.min(1, (attacks.length - (own.normal + own.crit) + 0.5) / 1.5))
    let gain = q * dmg * leverage
    const atkDamage = attacks.reduce((s, d) => s + (d.kind === 'crit' ? w.dmg.crit : w.dmg.normal), 0)
    if (atkDamage >= (view.operatives[seq.targetId]?.wounds ?? 99) && atkDamage - dmg < (view.operatives[seq.targetId]?.wounds ?? 99)) gain += q * 2
    return gain
  }
  // fight: an extra success is an extra strike or block
  const mine = side === 'attacker' ? seq.atk : seq.def
  const op = mine ? view.operatives[mine.operativeId] : undefined
  const w = mine?.weaponId ? view.data.weapons[mine.weaponId] : undefined
  if (!mine || !op || !w) return null
  const p = 1 - dieOdds(mine.need, mine.lethal ?? undefined).fail
  return p * avgDmg(w.dmg) * 0.8
}

/** dice.commandReroll: re-roll one failed die when the expected gain beats the threshold for our spare points. */
export function commandReroll(ctx: AiCtx): Action {
  const { pending, view } = ctx
  const cp = view.players[ctx.seat].cp
  const opts = pending.options ?? []
  const kinds = pending.context.kinds
  const side = String(pending.context.side ?? '')
  const gain = rerollGain(ctx, kinds, side)
  if (gain === null || gain < threshold(cp)) return passAction(pending)
  const failed = opts.find((o) => {
    const idx = (o.action.payload as { dice?: number[] }).dice?.[0]
    return typeof idx === 'number' && Array.isArray(kinds) && kinds[idx] === 'fail'
  })
  return failed ? failed.action : passAction(pending)
}

/** dice.reroll from weapon rules and equipment (free): the engine's policy re-rolls failed dice. */
export function ruleReroll(ctx: AiCtx): Action | null {
  return answerDecision(ctx.view, ctx.pending)
}

// ---------------------------------------------------------------------------
// Strategic gambits
// ---------------------------------------------------------------------------

const GAMBIT_SCORE: Record<string, number> = {
  // Tempestus Aquilons: the two free gambits (Rapid Insertion, moving the Drop markers) are scored on the board in taGambitScore
  'ta.p.rapid-insertion': 0.7,
  'ta.p.drop-insertion': 1.6,
  'ta.p.sudden-offensive': 1.7,
  'ta.p.maintain-momentum': 1.6,
  'ta.p.eye-above': 1.2,
  'ta.p.drop-and-secure': 1.3,
  // Farstalker Kinband (the Ready-step order change is a human convenience: the planner never wants it)
  'fk.p.call-the-kill': 2.0,
  'fk.p.farstalker-orders': 0,
  'fk.p.cut-throats': 1.3,
  'fk.p.rogue': 1.2,
  'fk.p.prey': 1.8,
  'fk.p.bound': 0.6,
  // Fellgor Ravagers: Call the Attack is free and moves the herd up; the flag ploys are scored by what the team carries
  'fg.p.call-the-attack': 1.6,
  'fg.p.violent-temperament': 1.4,
  'fg.p.ambush': 1.2,
  'fg.p.pelting-firepower': 1.3,
  'fg.p.reckless-determination': 1.1,
  'aod.p.combat-doctrine': 2.6,
  // Phobos Strike Team
  'ph.p.deadly-shots': 2.0,
  'ph.p.lethal-assaults': 1.4,
  'ph.p.and-they-shall-know-no-fear': 0.9,
  'ph.p.guerrilla-warfare': 0.6,
  'ph.p.omni-scrambler': 1.8,
  'aod.p.indomitus': 1.4,
  'aod.p.and-they-shall-know-no-fear': 0.9,
  'aod.p.adaptive-tactics': 0.2,
  'kom.p.dakka-dakka-dakka': 2.6,
  'kom.p.waaagh': 2.0,
  'kom.p.skulk-about': 1.7,
  'kom.p.ssssshhhh': 1.0,
  // Legionaries
  'lg.p.blood-for-the-blood-god': 1.7,
  'lg.p.implacable': 1.1,
  'lg.p.quicksilver-speed': 1.1,
  'lg.p.fickle-fates': 1.7,
  'lg.p.warded-armour': 1.6,
  'lg.p.chaos-talismans': 1.2,
  // Warpcoven
  'wc.p.aetherial-warding': 1.4,
  'wc.p.fate-itself-is-my-weapon': 1.8,
  'wc.p.brotherhood-of-sorcerers': 1.4,
  'wc.p.savage-herd': 1.5,
  // Kasrkin
  'ks.p.skill-at-arms': 1.8,
  'ks.p.elimination-pattern': 1.5,
  'ks.p.engage-from-cover': 1.2,
  'ks.p.clearance-sweep': 1.3,
  'ks.p.relocate': 0.9,
  // Scout Squad: the two Forward Scouting gambits are free (0 CP)
  'ss.p.guerrilla-engagement': 1.2,
  'ss.p.ambush': 1.5,
  'ss.p.adaptable-training': 0.5,
  'ss.p.stealth-relocation': 0.9,
  'ss.p.tactical-manoeuvre': 1.4,
  'ss.p.diversion': 1.2,
  // Hand of the Archon
  'ha.p.blade-artists': 2.0,
  'ha.p.merciless-sadists': 1.8,
  'ha.p.from-darkness-death': 1.5,
  'ha.p.denizens-of-night': 1.2,
  // Hunter Clade
  'hc.p.doctrina': 2.0,
  'hc.p.debilitating-irradiation': 1.0,
  'hc.p.neurostatic-interference': 1.2,
  'hc.p.scouting-protocol': 1.4,
  'hc.p.accelerant-agents': 1.6,
  'hc.p.rad-bombardment': 1.5,
  // Hearthkyn Salvagers
  'hk.p.eye-of-the-ancestors': 1.7,
  'hk.p.tactician': 1.6,
  'hk.p.need-keeps': 1.4,
  'hk.p.toil-earns': 1.1,
  'hk.p.wrought-defence': 1.4,
  'hk.p.proximate-firepower': 2.0,
  // Novitiates
  'nv.p.ardent-vengeance': 1.3,
  'nv.p.defenders-of-the-faith': 1.2,
  'nv.p.blessed-rejuvenation': 1.0,
  'nv.p.righteous-advance': 1.5,
  // Corsair Voidscarred
  'cv.p.plunderers': 1.1,
  'cv.p.piratical-profiteers': 1.3,
  'cv.p.mobile-engagement': 1.2,
  'cv.p.outcasts': 1.0,
  'cv.p.erudite-hunter': 1.0,
  'cv.p.star-charts': 1.0,
  // Goremongers: Enhanced Violence suits a melee team, Hunt for Blood is scored by the distance to the enemy below
  'gm.p.enhanced-violence': 1.7,
  'gm.p.augmented-endurance': 1.2,
  'gm.p.gory-tenacity': 1.3,
  'gm.p.hunt-for-blood': 1.4,
  // Imperial Navy Breachers
  'nb.p.attack-order': 1.9,
  'nb.p.defence-order': 1.3,
  'nb.p.close-assault': 1.5,
  'nb.p.brace-for-counterattack': 1.4,
  // Exaction Squad (the mark and the mastiff's patterns are scored per option in gambitScore)
  'ex.p.marked-for-justice': 2.0,
  'ex.p.attack-pattern': 1.6,
  'ex.p.first-in-the-field': 1.0,
  'ex.p.guilt-reveals-itself': 0.9,
  'ex.p.inviolate-jurisdiction': 0.9,
  'ex.p.dispense-justice': 1.2,
  'ex.p.terminal-decree': 1.3,
  // Chaos Cult: Mutation is free and turns Devotees into Mutants, so it always goes first; Baleful Script is never
  // worth giving up a gift for, and Covert Guises' free Repositions are a convenience the planner does not need
  'cc.p.mutation': 3.0,
  'cc.p.exaltation-in-pain': 1.0,
  'cc.p.fervent-onslaught': 1.5,
  'cc.p.creatures-of-nightmare': 0.9,
  'cc.p.sickening-aura': 1.0,
  'cc.p.baleful-script': 0,
  'cc.p.covert-guises': 0,
  // Blooded: the Blooded gambit is free and hands out the pool, so it always goes first
  'bl.p.blooded': 3.0,
  'bl.p.name-whispered': 1.6,
  'bl.p.glory-kill': 1.5,
  'bl.p.reckless-aspirant': 1.1,
  'bl.p.malevolent-grit': 1.2,
  'bl.p.bitter-demise': 1.0,
}

function nearestEnemyDistances(view: GameState, seat: string): number[] {
  const mine = seatOps(view, seat as 'A' | 'B')
  const theirs = enemiesOf(view, { seat: seat as 'A' | 'B' })
  return mine.map((m) => Math.min(99, ...theirs.map((e) => distanceBetween(bodyOf(m), bodyOf(e)))))
}

function doctrineScore(view: GameState, seat: string, param: string): number {
  const d = nearestEnemyDistances(view, seat)
  const avg = d.length ? d.reduce((s, x) => s + x, 0) / d.length : 12
  const engaged = d.filter((x) => x <= 1.5).length
  if (param === 'devastator') return 2.4 + (avg > 8 ? 0.7 : 0)
  if (param === 'tactical') return 2.2 + (avg <= 7 && avg > 2.5 ? 0.6 : 0)
  if (param === 'assault') return 1.6 + engaged * 0.8 + (avg <= 3 ? 0.8 : 0)
  return 1
}

const liveOps = (view: GameState, seat: string): Operative[] => seatOps(view, seat as 'A' | 'B').filter((o) => o.status === 'active' && o.wounds > 0)

/** How many of our live operatives carry a ranged weapon and a named melee weapon (not bare fists). */
function mix(view: GameState, seat: string): { ranged: number; melee: number } {
  let ranged = 0
  let melee = 0
  for (const o of liveOps(view, seat)) {
    if (o.weapons.some((w) => view.data.weapons[w]?.type === 'ranged')) ranged++
    if (o.weapons.some((w) => view.data.weapons[w]?.type === 'melee' && !/fists$/.test(w))) melee++
  }
  return { ranged, melee }
}

const countKeyword = (view: GameState, seat: string, kw: string): number => liveOps(view, seat).filter((o) => hasKeyword(view, o, kw)).length

/** Hunter Clade Imperatives (Doctrina, Command Override): the mode that suits the team's weapons and the fight ahead. */
function imperativeScore(view: GameState, seat: string, param: string): number {
  const [mode, flag] = param.split(':')
  const { ranged, melee } = mix(view, seat)
  const total = Math.max(1, ranged + melee)
  const d = nearestEnemyDistances(view, seat)
  const avg = d.length ? d.reduce((s, x) => s + x, 0) / d.length : 12
  let s: number
  switch (mode) {
    case 'protector':
      // Ceaseless ranged weapons, worse melee Hit: best for a shooting team
      s = 1 + (ranged / total) * 1.6 - (melee / total) * 0.9
      break
    case 'conqueror':
      s = 1 + (melee / total) * 1.6 - (ranged / total) * 0.9 + (avg < 6 ? 0.3 : 0)
      break
    case 'bulwark':
      // less damage from heavy hits, 1 inch less Move: best when the enemy is already close
      s = 1.1 + (avg < 7 ? 0.4 : 0)
      break
    case 'aggressor':
      s = 1.0 + (avg > 9 ? 0.5 : 0)
      break
    default:
      s = 0.3
  }
  // the Deprecation-ignoring pick of the Primary Mode costs a once-per-battle use: worth it while it still helps
  if (flag === 'ignore') s += 0.35
  return s
}

/** Tempestus Aquilons gambits: Drop markers are worth moving while operatives are still above; the marks go where the team fights. */
function taGambitScore(view: GameState, seat: string, gambitId: string, param: string | undefined, s: number): number {
  const mine = Object.values(view.operatives).filter((o) => o.seat === seat)
  const live = mine.filter((o) => o.status === 'active' && o.wounds > 0)
  const above = mine.filter((o) => o.status === 'reserve' && o.offboard !== undefined).length
  const near = (x: number, z: number): number => Math.min(99, ...live.map((o) => Math.hypot(o.pos.x - x, o.pos.z - z)))
  switch (gambitId) {
    case 'ta.p.rapid-insertion':
      return live.filter((o) => view.data.datacards[o.datacardId]?.keywords.includes('TROOPER')).length >= 2 ? s : 0.4
    case 'ta.p.drop-insertion':
      // only the operatives still above use the markers
      return above > 0 ? s : 0
    case 'ta.p.sudden-offensive':
      return live.length + above >= 6 ? s : 0.8
    case 'ta.p.eye-above': {
      // the Detected mark: the enemy nearest to the team, a little more for a group of enemies within 3 inches of it
      const e = param ? view.operatives[param] : undefined
      if (!e) return s
      const crowd = enemiesOf(view, { seat: seat as 'A' | 'B' }).filter((x) => x.id !== e.id && x.status === 'active' && distanceBetween(bodyOf(x), bodyOf(e)) <= 3).length
      return s - Math.min(near(e.pos.x, e.pos.z), 20) * 0.03 + 0.15 * crowd
    }
    case 'ta.p.drop-and-secure': {
      // an objective or mission marker the team will contest: the nearest one counts most
      const m = param ? view.markers.find((k) => k.id === param) : undefined
      if (!m) return s
      return s - Math.min(near(m.pos.x, m.pos.z), 20) * 0.05
    }
    default:
      return s
  }
}

/** Param-aware value of one gambit option. */
function gambitScore(view: GameState, seat: string, gambitId: string, param: string | undefined): number {
  const s = GAMBIT_SCORE[gambitId] ?? 0.8
  if (gambitId.startsWith('ta.p.')) return taGambitScore(view, seat, gambitId, param, s)
  if (gambitId === 'aod.p.combat-doctrine' && param) return doctrineScore(view, seat, param)
  if (gambitId === 'hc.p.doctrina' && param) return imperativeScore(view, seat, param) + 0.8
  const { ranged, melee } = mix(view, seat)
  switch (gambitId) {
    case 'fk.p.call-the-kill': {
      // the mark: the enemy nearest to our team (it will be shot and fought), a little more for a big one
      const e = param ? view.operatives[param] : undefined
      if (!e) return s
      const near = Math.min(99, ...liveOps(view, seat).map((m) => distanceBetween(bodyOf(m), bodyOf(e))))
      return s - Math.min(near, 20) * 0.03 + e.maxWounds * 0.02
    }
    case 'fk.p.cut-throats':
      return melee >= 3 ? s : 0.7
    case 'fk.p.prey':
      return ranged >= 3 ? s : 0.8
    case 'ph.p.deadly-shots':
      return ranged >= 3 ? s : 1.0
    case 'ph.p.omni-scrambler': {
      // jam the enemy that is closest to our team and still ready: the longer it sits out, the more it is worth
      const e = param ? view.operatives[param] : undefined
      if (!e) return s
      const near = Math.min(99, ...liveOps(view, seat).map((m) => distanceBetween(bodyOf(m), bodyOf(e))))
      return s - Math.min(near, 20) * 0.03 + e.wounds * 0.02 + (e.ready ? 0.3 : 0)
    }
    case 'lg.p.blood-for-the-blood-god':
      return countKeyword(view, seat, 'KHORNE') > 0 || melee >= 2 ? s : 0.3
    case 'lg.p.implacable':
      return countKeyword(view, seat, 'NURGLE') > 0 ? s + 0.4 : 0.7
    case 'lg.p.quicksilver-speed':
      return countKeyword(view, seat, 'SLAANESH') > 0 ? s + 0.4 : 0.7
    case 'lg.p.fickle-fates':
      return ranged >= 2 ? s : 0.6
    case 'lg.p.warded-armour': {
      // the Legionary closest to the enemy with the weakest Save gains the most
      const op = param ? view.operatives[param] : undefined
      if (!op) return s
      const near = Math.min(99, ...enemiesOf(view, op).map((e) => distanceBetween(bodyOf(op), bodyOf(e))))
      return s + (op.save - 2) * 0.25 + (near < 10 ? 0.4 : 0) + op.wounds * 0.03
    }
    case 'lg.p.chaos-talismans':
      return s + (param ? countKeyword(view, seat, param) * 0.15 : 0)
    case 'wc.p.brotherhood-of-sorcerers':
      // Balanced, or Ceaseless with a second Sorcerer near: only worth a point with two Sorcerers
      return countKeyword(view, seat, 'SORCERER') >= 2 ? s + 0.3 : 0.7
    case 'wc.p.savage-herd':
      return countKeyword(view, seat, 'TZAANGOR') >= 2 ? s : 0.6
    case 'wc.p.aetherial-warding':
      return ranged + melee >= 4 ? s : 0.9
    case 'ks.p.skill-at-arms': {
      // a free gambit: one or two skills (Veteran Leadership), each worth what the squad's weapons make of it
      const weight: Record<string, number> = { 'light-em-up': 0.9 + 0.1 * ranged, 'ice-in-your-veins': 0.7, 'strike-fast': 0.45, 'for-cadia': 0.2 + 0.2 * melee }
      return 0.4 + (param ?? '').split('+').reduce((n, k) => n + (weight[k] ?? 0), 0)
    }
    case 'ks.p.clearance-sweep': {
      // the marker pays off where our shooters and their targets both stand within 5 inches of it
      const [px, pz] = (param ?? '').split(',').map(Number)
      if (px === undefined || pz === undefined || !Number.isFinite(px) || !Number.isFinite(pz)) return s
      const near = (o: Operative): boolean => Math.hypot(o.pos.x - px, o.pos.z - pz) <= 5
      const own = liveOps(view, seat).filter((o) => near(o) && o.weapons.some((w) => view.data.weapons[w]?.type === 'ranged')).length
      const foes = enemiesOf(view, { seat: seat as 'A' | 'B' }).filter((e) => e.status === 'active' && e.wounds > 0 && near(e)).length
      return own > 0 && foes > 0 ? s + 0.3 * Math.min(own, 3) + 0.2 * Math.min(foes, 3) : 0.3
    }
    case 'ks.p.relocate': {
      // a free group move toward the objectives: worth it from turning point 2 while nothing blocks it
      const pick = param ? view.operatives[param] : undefined
      return pick ? s + Math.min(1, (countKeyword(view, seat, 'KASRKIN') - 3) * 0.1) : s
    }
    case 'ss.p.guerrilla-engagement':
      return ranged >= 3 ? s : 0.6
    case 'ss.p.tactical-manoeuvre': {
      // +1 APL for the friend nearest the enemy that can shoot or fight with it
      const pick = param ? view.operatives[param] : undefined
      if (!pick) return s
      const near = Math.min(99, ...enemiesOf(view, pick).map((e) => distanceBetween(bodyOf(pick), bodyOf(e))))
      return s - Math.min(near, 20) * 0.03 + (pick.weapons.some((w) => view.data.weapons[w]?.type === 'ranged') ? 0.2 : 0) + (pick.apl >= 3 ? -0.3 : 0)
    }
    case 'ss.p.diversion': {
      // -1 APL for the enemy nearest our team (the one that will act against us), more for APL 3
      const e = param ? view.operatives[param] : undefined
      if (!e) return s
      const near = Math.min(99, ...liveOps(view, seat).map((m) => distanceBetween(bodyOf(m), bodyOf(e))))
      return s - Math.min(near, 20) * 0.03 + (e.apl >= 3 ? 0.3 : 0)
    }
    case 'ss.p.adaptable-training':
    case 'ss.p.stealth-relocation':
      return view.turningPoint >= 2 ? s : 0.3
    case 'ha.p.blade-artists':
      return melee >= 2 ? s : 0.8
    case 'ha.p.merciless-sadists':
      return view.turningPoint >= 2 ? s : s - 0.5
    case 'hc.p.scouting-protocol':
    case 'hc.p.rad-bombardment':
      return view.turningPoint >= 2 ? s : 0
    case 'hc.p.accelerant-agents':
      return liveOps(view, seat).some((o) => hasKeyword(view, o, 'RUSTSTALKER')) ? s : 0.3
    case 'hc.p.debilitating-irradiation':
      return liveOps(view, seat).some((o) => hasKeyword(view, o, 'VANGUARD')) ? s : 0.3
    case 'hc.p.neurostatic-interference':
      return liveOps(view, seat).some((o) => hasKeyword(view, o, 'INFILTRATOR')) ? s : 0.3
    case 'cc.p.creatures-of-nightmare':
    case 'cc.p.sickening-aura':
      // both read the Mutants and Torments around the enemy: worth a point once the cult has some
      return liveOps(view, seat).some((o) => o.datacardId === 'cc.mutant' || o.datacardId === 'cc.torment') ? s : 0.2
    case 'cc.p.exaltation-in-pain':
      return liveOps(view, seat).some((o) => o.wounds < o.maxWounds) ? s + 0.3 : 0.4
    case 'cc.p.fervent-onslaught':
      return melee >= 3 ? s : 0.7
    case 'hk.p.tactician':
      return param === 'defence' ? s - 0.3 : s
    case 'nv.p.blessed-rejuvenation':
      // it heals only on Faith spends: worth the point once the pool can pay for a few
      return (view.players[seat as 'A' | 'B'].pools?.['nv.faith'] ?? 0) >= 4 ? s + 0.4 : 0.2
    case 'nv.p.ardent-vengeance':
      return countKeyword(view, seat, 'NOVITIATE') >= 4 ? s : 0.6
    case 'nv.p.defenders-of-the-faith':
      return view.markers.some((m) => m.kind === 'objective') ? s : 0.3
    case 'hk.p.eye-of-the-ancestors': {
      // a Grudge token on the enemy nearest to us (the mark is wasted on one that never meets us)
      const first = (param ?? '').split('+')[0] ?? ''
      const e = view.operatives[first]
      if (!e) return s
      const near = Math.min(99, ...liveOps(view, seat).map((m) => distanceBetween(bodyOf(m), bodyOf(e))))
      return s - Math.min(near, 20) * 0.03 + (param?.includes('+') ? 0.3 : 0)
    }
    case 'nb.p.attack-order':
    case 'nb.p.defence-order': {
      // the marker covers the Breachers within 3": put it where most of them are
      const [x, z] = (param ?? '').split(',').map(Number)
      if (x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z)) return s
      const covered = liveOps(view, seat).filter((o) => Math.hypot(o.pos.x - x, o.pos.z - z) - o.baseRadius <= 3).length
      return s + 0.3 * Math.min(covered, 5) - 0.6
    }
    case 'gm.p.hunt-for-blood': {
      // a free 3" Charge (and Engage): worth it when the pick starts close enough to reach an enemy
      const g = param ? view.operatives[param] : undefined
      if (!g) return s
      const near = Math.min(99, ...enemiesOf(view, g).filter((e) => e.status === 'active').map((e) => distanceBetween(bodyOf(g), bodyOf(e))))
      return near <= 4 ? s + 0.5 : near <= 7 ? s - 0.4 : 0.2
    }
    case 'nb.p.close-assault':
      return ranged >= 2 ? s : 0.8
    case 'ex.p.marked-for-justice': {
      // the mark: the enemy nearest to our team (it will be shot and fought), a little more for a big one
      const e = param ? view.operatives[param] : undefined
      if (!e) return s
      const near = Math.min(99, ...liveOps(view, seat).map((m) => distanceBetween(bodyOf(m), bodyOf(e))))
      return s - Math.min(near, 20) * 0.03 + e.maxWounds * 0.02
    }
    case 'ex.p.attack-pattern':
      // Swift and Aggressive carry the hound into the fight; Defensive only toughens it
      return s + (param === 'aggressive+swift' ? 0.4 : param === 'swift+defensive' ? 0.1 : 0)
    case 'ex.p.first-in-the-field':
      return s
    case 'ex.p.terminal-decree':
      return ranged >= 4 ? s : 0.7
    case 'ex.p.dispense-justice':
      return melee >= 3 ? s : 0.7
    case 'bl.p.name-whispered':
    case 'bl.p.glory-kill': {
      // the mark: the enemy nearest to our team (the one we will shoot and fight), a little more for a big one
      const e = param ? view.operatives[param] : undefined
      if (!e) return s
      const near = Math.min(99, ...liveOps(view, seat).map((m) => distanceBetween(bodyOf(m), bodyOf(e))))
      return s - Math.min(near, 20) * 0.03 + e.maxWounds * 0.02
    }
    case 'hk.p.need-keeps':
    case 'hk.p.toil-earns': {
      const m = param ? view.markers.find((k) => k.id === param) : undefined
      if (!m) return s
      const near = Math.min(99, ...liveOps(view, seat).map((o) => Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z)))
      return s - Math.min(near, 20) * 0.04
    }
    default:
      return s
  }
}

/** strategy.gambit: the best gambit when it is worth the point, else pass. One reserve point stays for re-rolls after the first. */
export function gambit(ctx: AiCtx): Action {
  const { pending, view } = ctx
  const cp = view.players[ctx.seat].cp
  const used = view.strategy.gambit.used[ctx.seat].length
  let best: { o: DecisionOption; s: number; free: boolean } | null = null
  for (const o of pending.options ?? []) {
    const p = o.action.payload as { gambitId: string; param?: string }
    const cost = Number(o.data?.cost ?? 1)
    if (cost > cp) continue
    const free = cost === 0
    if (!free && used > 0 && cp - cost < 1) continue
    let s = gambitScore(view, ctx.seat, p.gambitId, p.param)
    if (!ctx.params.tacAware && !free) s *= 0.7
    if (!best || s > best.s) best = { o, s, free }
  }
  // the first gambit of the turning point is almost always worth it; the next ones need clear value; a free one needs little
  if (best && best.s >= (best.free ? 0.5 : used === 0 ? 0.8 : 1.6)) return best.o.action
  return passAction(pending)
}

// ---------------------------------------------------------------------------
// Firefight ploys
// ---------------------------------------------------------------------------

const PLOY_SCORE: Record<string, number> = {
  // Tempestus Aquilons: Hot Drop re-rolls the whole attack, Progena heals (scored by the wounds missing in taPloyScore), the
  // Exemplars discount is only offered with a marker or mission action to take, Adjust Coordinates is paid inside the landing
  'ta.p.hot-drop': 2.0,
  'ta.p.progena': 1.2,
  'ta.p.tempestus-exemplars': 1.1,
  'ta.p.adjust-coordinates': 0,
  'ta.e.drop-augury': 0.7,
  // Farstalker Kinband: firefight ploys and the free (0 CP) offers
  'fk.p.savage-ambush': 2.0,
  'fk.p.slip-away': 1.2,
  'fk.p.poach': 1.2,
  'fk.p.vengeance-for-the-kinband': 1.8,
  'fk.x.repick': 2.0,
  'fk.x.shriek': 1.8,
  'fk.x.assault': 2.2,
  'fk.x.force': 1.8,
  'fk.x.quick-draw': 2.0,
  'fk.e.piercing-shot': 1.5,
  'fk.e.toxin-shot': 1.5,
  'fk.e.meat': 1.4,
  'fk.e.trophy': 1.2,
  'fk.x.rfa-piercing-shot': 1.4,
  'fk.x.rfa-toxin-shot': 1.3,
  'fk.x.rfa-meat': 1.2,
  'aod.p.wrath-of-vengeance': 3,
  // Phobos Strike Team: Patient Ambush and the Comms Array swaps of the four strategy ploys are scored in ployScore
  // (they depend on the board); the rest are cheap and good
  'ph.p.critical-shot': 2.0,
  'ph.p.transhuman-physiology': 2.0,
  'ph.p.stealth-assault': 2.2,
  'ph.e.purity-seals': 1.6,
  'ph.e.special-issue-ammunition': 1.5,
  'ph.medicDash': 1.0,
  'ph.plantDash': 0.2,
  'aod.p.transhuman-physiology': 2,
  'kom.p.just-a-scratch': 2,
  'aod.p.shock-assault': 2.2,
  'kom.p.kunnin-but-brutal': 2.2,
  'kom.p.krump-em': 2.4,
  'aod.p.adjust-doctrine': 0,
  'kom.p.shake-it-off': 0.4,
  // Warpcoven: paid ploys; the free offers (reserved dice, boons, Savage Brutality) are scored per option below
  'wc.p.all-is-dust': 1.9,
  'wc.p.capricious-plan': 0.9,
  'wc.p.psychic-cabal': 1.5,
  'wc.p.mutant-herd': 1.3,
  'wc.a.fate-reserve': 0,
  'wc.a.boon-echoes-from-the-warp': 1.7,
  'wc.a.boon-astral-bombardment': 0.6,
  'wc.a.savage-brutality': 2.0,
  'wc.e.sorcerous-scrolls': 0,
  // Legionaries
  'lg.p.unending-bloodshed': 2.0,
  'lg.p.mutability-and-change': 1.5,
  'lg.p.malignant-aura': 1.6,
  'lg.p.sickening-captivation': 1.6,
  // Kasrkin
  'ks.p.seize-the-initiative': 1.2,
  'ks.p.cover-retreat': 1.4,
  'ks.p.neutralise-target': 1.8,
  'ks.p.give-no-ground': 1.6,
  'ks.medicDash': 1.0,
  'ks.e.relics-of-cadia': 1.6,
  // Scout Squad: Astartes Training is scored per option in ployScore
  'ss.p.emboldened-aspirant': 2.0,
  'ss.p.raw-physiology': 0.9,
  'ss.p.covert-position': 0.8,
  'ss.e.targeting-oculars': 1.7,
  // Hand of the Archon: paid ploys
  'ha.p.cruel-deception': 0.7,
  'ha.p.devious-scheme': 1.2,
  // skipping the AI's own activation is never a good turn
  'ha.p.heinous-arrogance': 0,
  'ha.p.prey-on-the-wounded': 2.0,
  // Hand of the Archon: free offers (Pain invigorations and the rest)
  'ha.inv.animus': 1.8,
  'ha.inv.rejuvenation': 1.5,
  'ha.inv.surge': 1.1,
  'ha.inv.senses': 1.3,
  'ha.tv': 1.6,
  'ha.flay': 1.2,
  'ha.omen': 1.4,
  'ha.bd': 1.0,
  'ha.fdd': 1.5,
  'ha.e.refined-poison': 1.6,
  'ha.e.toxin-coating': 1.6,
  // Hunter Clade
  'hc.p.control-edict': 1.8,
  'hc.p.scrapcode-overload': 1.3,
  'hc.p.command-override': 1.7,
  'hc.p.omnissiahs-imperative': 1.9,
  'hc.e.redundancy-systems': 1.3,
  'hc.e.refractor-field': 1.3,
  // Hearthkyn Salvagers
  'hk.p.the-ancestors-are-watching': 2.1,
  'hk.p.worth-it': 1.4,
  'hk.p.sturdy': 2.0,
  'hk.p.engage-to-acquire': 2.0,
  'hk.medicDash': 1.0,
  // Novitiates: the Faith acts are scored by faithScore, the rest are cheap and good when offered
  'nv.p.glorious-martyrdom': 1.7,
  'nv.p.blazing-inferno': 1.9,
  'nv.p.blinding-aura': 1.5,
  'nv.p.guided-by-faith': 0.8,
  'nv.a.absolution-through-destruction': 2.2,
  'nv.a.medic': 1.0,
  'nv.a.blaze-token': 0.8,
  // Corsair Voidscarred: 2D3 per Corsair is a lot of damage; the activation ploys are rarely worth their CP, free ones are cheap
  'cv.p.opportunistic-fighters': 1.7,
  'cv.p.light-fingers': 0.6,
  'cv.p.capricious-flight': 0.5,
  'cv.p.contemptuous-adventurer': 1.3,
  // free offers: Slicing Attack is D3+2 damage; Mistfield only comes up when the shot has Piercing
  'cv.a.slicing-attack': 1.9,
  'cv.e.mistfield': 1.4,
  // Goremongers: the paid firefight ploys; the free (gm.x) offers are scored by gmScore
  'gm.p.unbridled-aggression': 2.0,
  'gm.p.gorethirst': 1.0,
  'gm.p.destructive-demise': 2.0,
  'gm.p.lacerate-flesh': 0.8,
  // Imperial Navy Breachers
  'nb.p.overwhelm-target': 1.6,
  'nb.p.blitz': 1.8,
  'nb.p.lock-it-down': 1.1,
  'nb.p.deck-hand': 0.5,
  // free offers: the Breach and Clear pairing and Slugs are cheap and good; the order redirect is never worth the prompt
  'nb.bc': 1.7,
  'nb.e.slugs': 1.4,
  'nb.redirect': 0.2,
  // Exaction Squad: paid ploys and the free (0 CP) offers
  'ex.p.long-arm': 1.0,
  'ex.p.brutal-backup': 1.9,
  'ex.p.execution-order': 1.2,
  'ex.p.exact-punishment': 1.6,
  'ex.x.handler': 2.2,
  'ex.x.medicDash': 1.0,
  'ex.x.exec-shoot': 2.0,
  'ex.x.exec-fight': 2.0,
  'ex.x.shells-saturate': 1.5,
  'ex.x.shells-piercing': 1.6,
  'ex.x.shells-torrent': 0.8,
  // Blooded: Callous Disregard hurts our own, so it is held back; the free offers (Avalanche of Muscle, Shielding) are scored below
  'bl.p.callous-disregard': 0.2,
  'bl.p.moment-of-repute': 1.5,
  'bl.p.reward-earned': 1.6,
  'bl.p.dark-favour': 0.4,
  'bl.a.avalanche-of-muscle': 2.0,
  'bl.a.shielding': 0.2,
  // Fellgor Ravagers: paid ploys, and the free offers (Savage, Violent Temperament and Chaos Sigil are scored below; Gore Marks
  // costs wounds and Sagacious only flips an order, so the planner leaves them)
  'fg.p.ruthless-rampage': 1.3,
  'fg.p.wild-rage': 1.2,
  'fg.p.animalistic-fury': 1.8,
  'fg.p.bloodsense': 1.4,
  'fg.x.savage': 2.0,
  'fg.x.sagacious': 0.2,
  'fg.e.gore-marks': 0.2,
  'fg.e.chaos-sigil': 1.3,
  // Chaos Cult: paid ploys (Abhorrent Mutation's gift pick is scored in ployScore) and the free offers
  'cc.p.faithful-follower': 1.6,
  'cc.p.abhorrent-mutation': 1.4,
  'cc.p.frenzied-demise': 1.8,
  'cc.p.unleash-the-daemon': 2.2,
  'cc.a.attuned-in-purpose': 1.2,
  'cc.a.gift-horned': 1.8,
  'cc.e.unholy-talisman': 1.7,
}

// ---------------------------------------------------------------------------
// Novitiates: ACTS OF FAITH. Faith points are a public pool, so an act is worth the wounds it is expected to change in the
// open sequence less what its points are worth; the last points are kept before turning point 4 unless the act decides
// whether an operative is incapacitated.
// ---------------------------------------------------------------------------

const NV_ACT_COST: Record<string, number> = { 'nv.a.guidance': 1, 'nv.a.blessing': 2, 'nv.a.intervention': 3 }

function faithScore(view: GameState, seat: string, p: { ployId: string; param?: string; operativeId?: string }): number {
  const a = view.attack
  const seq = a?.seq
  const op = p.operativeId ? view.operatives[p.operativeId] : undefined
  if (!a || !seq || !op) return 0
  const pool = view.players[seat as 'A' | 'B'].pools?.['nv.faith'] ?? 0
  // Sanctified Rounds on its own: Piercing Crits 1 only matters when a crit is kept
  if (p.ployId === 'nv.e.sanctified-rounds') {
    const crits = seq.atk.dice.filter((d) => d.kind === 'crit' && !d.used).length
    return crits > 0 ? 0.9 : 0.1
  }
  const costFaith = NV_ACT_COST[p.ployId]
  if (costFaith === undefined) return 0
  const free = p.param === 'free'
  const side = seq.atk.operativeId === op.id ? seq.atk : seq.def
  if (!side) return 0
  const fails = side.dice.filter((d) => d.kind === 'fail' && !d.used && d.value !== null).length
  const normals = side.dice.filter((d) => d.kind === 'normal' && !d.used).length
  const crits = side.dice.filter((d) => d.kind === 'crit' && !d.used).length
  const weapon = a.weaponId ? view.data.weapons[a.weaponId] : undefined
  let gain = 0
  let decisive = false
  if (a.kind === 'shoot' && side === seq.def) {
    // a Novitiate being shot: how much damage does one more save (or a crit save) prevent?
    const attacker = seq.atk.dice.filter((d) => !d.used)
    const an = attacker.filter((d) => d.kind === 'normal').length
    const ac = attacker.filter((d) => d.kind === 'crit').length
    if (!weapon) return 0
    const brutal = weapon.rules.some((r) => r.rule === 'brutal')
    const before = autoBlock(an, ac, normals, crits, weapon.dmg, brutal).damage
    const q = 1 - dieOdds(op.save).fail
    let after = before
    if (p.ployId === 'nv.a.intervention') after = autoBlock(an, ac, normals + 1, crits, weapon.dmg, brutal).damage
    else if (p.ployId === 'nv.a.blessing' && normals > 0) after = autoBlock(an, ac, normals - 1, crits + 1, weapon.dmg, brutal).damage
    else if (p.ployId === 'nv.a.guidance' && fails > 0) after = before - q * (before - autoBlock(an, ac, normals + 1, crits, weapon.dmg, brutal).damage)
    gain = before - after
    decisive = before >= op.wounds && after < op.wounds
  } else if (a.kind === 'shoot') {
    // a Novitiate shooting: the extra damage that gets through the target's expected saves
    const target = view.operatives[seq.targetId]
    if (!target || !weapon) return 0
    const defSucc = 3 * (1 - dieOdds(target.save).fail) + (seq.cover ? 0.5 : 0)
    const k = normals + crits
    const hit = 1 - dieOdds(side.need, side.lethal ?? undefined).fail
    const lev = (extra: number) => Math.max(0.15, Math.min(1, (k + extra - defSucc + 1.5) / 2))
    const avg = weapon.dmg.normal * 0.7 + weapon.dmg.crit * 0.3
    if (p.ployId === 'nv.a.guidance') gain = fails > 0 ? hit * avg * lev(0.5) : 0
    else if (p.ployId === 'nv.a.intervention') gain = fails > 0 ? weapon.dmg.normal * lev(1) : 0
    else if (p.ployId === 'nv.a.blessing' && normals > 0 && !seq.obscured) {
      const rule = (name: string) => weapon.rules.find((r) => r.rule === name)
      gain = Math.max(0, weapon.dmg.crit - weapon.dmg.normal) * lev(0) + (crits === 0 && (rule('rending') || rule('punishing')) ? 0.9 : 0) + (rule('devastating')?.x ?? 0) * 0.8
    }
    decisive = gain > 0 && target.wounds <= weapon.dmg.normal * (k + 1) && target.wounds > weapon.dmg.normal * k * 0.8
  } else {
    // a fight: every extra success is an extra strike or block
    const w = side.weaponId ? view.data.weapons[side.weaponId] : undefined
    if (!w) return 0
    const hit = 1 - dieOdds(side.need, side.lethal ?? undefined).fail
    if (p.ployId === 'nv.a.guidance') gain = fails > 0 ? hit * (w.dmg.normal * 0.7 + w.dmg.crit * 0.3) * 0.8 : 0
    else if (p.ployId === 'nv.a.intervention') gain = fails > 0 ? w.dmg.normal * 0.8 : 0
    else if (p.ployId === 'nv.a.blessing' && normals > 0) gain = Math.max(0, w.dmg.crit - w.dmg.normal) * 0.8 + (crits === 0 && w.rules.some((r) => r.rule === 'rending') ? 0.9 : 0)
  }
  if (gain <= 0) return 0
  if (free) {
    // the price is wounds: only above half, and only for a clear gain
    if (op.wounds - costFaith <= op.maxWounds / 2) return 0
    return Math.max(0, gain - 0.45 * costFaith)
  }
  // keep the last points for later turning points unless this decides an incapacitation
  if (view.turningPoint < 4 && pool - costFaith < 2 && !decisive) return 0
  return Math.max(0, gain + (decisive ? 2 : 0) - 0.35 * costFaith)
}

const PH_STRATEGY = ['ph.p.guerrilla-warfare', 'ph.p.and-they-shall-know-no-fear', 'ph.p.deadly-shots', 'ph.p.lethal-assaults']

/** What a Phobos strategy ploy is worth on the board now (for a Comms Array swap): the friends it would help this turning point. */
function phStrategyValue(view: GameState, seat: string, id: string): number {
  const mine = seatOps(view, seat as 'A' | 'B').filter((o) => o.status === 'active' && o.wounds > 0)
  const foes = enemiesOf(view, { seat: seat as 'A' | 'B' }).filter((e) => e.status === 'active')
  const near = (o: Operative, r: number): boolean => foes.some((e) => distanceBetween(bodyOf(o), bodyOf(e)) <= r)
  switch (id) {
    case 'ph.p.deadly-shots':
      return 0.25 * mine.filter((o) => o.weapons.some((w) => view.data.weapons[w]?.type === 'ranged') && near(o, 18)).length
    case 'ph.p.lethal-assaults':
      return 0.35 * mine.filter((o) => o.weapons.some((w) => view.data.weapons[w]?.type === 'melee' && !/fists$/.test(w)) && near(o, 9)).length
    case 'ph.p.and-they-shall-know-no-fear':
      return 0.5 * mine.filter((o) => o.wounds * 2 < o.maxWounds).length
    case 'ph.p.guerrilla-warfare':
      return 0.2
    default:
      return 0
  }
}

// ---------------------------------------------------------------------------
// Goremongers: the free (0 CP) offers between actions and in the attack windows, and the firefight ploys that need the
// board. A gore tank level is the currency: Sanguavitae is spent when it clearly pays, the half tank is kept for
// Enhanced Violence otherwise, and the free refills (Khorne's Favour, Bleeding, Incite the Hunt) are always taken.
// ---------------------------------------------------------------------------

function gmScore(view: GameState, p: { ployId: string; param?: string; operativeId?: string }): number | null {
  const op = p.operativeId ? view.operatives[p.operativeId] : undefined
  const level = op ? Math.min(2, gmTokenCount(view, op.id, 'gm.gore')) : 0
  const nearest = op ? Math.min(99, ...enemiesOf(view, op).filter((e) => e.status === 'active').map((e) => distanceBetween(bodyOf(op), bodyOf(e)))) : 99
  switch (p.ployId) {
    case 'gm.x.rejuvenate': {
      // D3+1 wounds back: from 3 lost wounds up
      const missing = op ? op.maxWounds - op.wounds : 0
      return missing >= 3 ? 0.5 + 0.2 * Math.min(missing, 6) : 0
    }
    case 'gm.x.mania':
      // one more AP for a full tank, with enemies about
      return level >= 2 && nearest <= 14 ? 0.7 : 0
    case 'gm.x.fury':
      // two Fights once an enemy is in control range
      return nearest <= 1.05 && level >= 1 ? (level >= 2 ? 1.6 : 1.1) : 0
    case 'gm.x.surge':
      // a Charge that is just out of reach: 9 inches of Move plus the 1 inch of control range
      return nearest > 10 && nearest <= 11.2 ? 1.1 : 0
    case 'gm.x.rage':
      return level >= 2 ? 0.9 : 0.28
    case 'gm.x.rake': {
      const t = p.param ? view.operatives[p.param] : undefined
      return 1.3 + (t && t.wounds <= 3 ? 0.8 : 0) - (level <= 1 ? 0.3 : 0)
    }
    case 'gm.x.favour':
      return 3
    case 'gm.x.bleeding':
      return 2.4
    case 'gm.x.incite': {
      const f = p.param ? view.operatives[p.param] : undefined
      return 2.0 + (f && gmTokenCount(view, f.id, 'gm.gore') === 0 ? 0.5 : 0)
    }
    case 'gm.x.apotheosis': {
      // once per battle: spend it when it decides whether the Herald is taken down, or at least keeps it above half
      const u = view.attack?.seq?.unblocked
      const w = view.attack?.weaponId ? view.data.weapons[view.attack.weaponId] : undefined
      if (!u || !w || !op) return 0.2
      const total = u.normal * w.dmg.normal + u.crit * w.dmg.crit
      if (total >= op.wounds && total - w.dmg.normal < op.wounds) return 3
      const left = op.wounds - total
      return left <= op.maxWounds / 2 && left + w.dmg.normal > op.maxWounds / 2 ? 1.3 : 0.2
    }
    case 'gm.x.drag': {
      // a full pull sets up the charge; the drag distance is the parameter
      const n = Number(p.param ?? 0)
      return n === 0 ? 0.35 : 0.4 + 0.1 * n
    }
    case 'gm.x.discard':
      return 0
    case 'gm.x.sigil':
      return 1.6
    case 'gm.p.gorethirst':
      // the planner only counteracts with a Conceal Goremonger when the counteraction pays; unpaid it can do nothing at all
      return 3
    case 'gm.p.destructive-demise': {
      const t = p.param ? view.operatives[p.param] : undefined
      return 2.0 - (t ? Math.min(t.wounds, 10) * 0.05 : 0)
    }
    default:
      return null
  }
}

/** Value of one offered firefight ploy, from the id and the operative or parameter it names. */
function ployScore(view: GameState, seat: string, p: { ployId: string; param?: string; operativeId?: string }, windowId: string): number {
  // Comms Array: swap a strategy ploy already used for one not yet used; worth the difference on this board
  if (PH_STRATEGY.includes(p.ployId) && p.param && PH_STRATEGY.includes(p.param)) {
    const gain = phStrategyValue(view, seat, p.ployId) - phStrategyValue(view, seat, p.param)
    return gain >= 0.25 ? 0.3 + gain : 0
  }
  if (p.ployId.startsWith('gm.')) {
    const g = gmScore(view, p)
    if (g !== null) return g
  }
  const s = PLOY_SCORE[p.ployId] ?? (p.ployId.startsWith('ha.inv.') ? 1.4 : 0.9)
  const op = p.operativeId ? view.operatives[p.operativeId] : undefined
  // Tempestus Aquilons: Progena is worth the wounds it can give back; Drop Augury only while an operative is still above
  if (p.ployId === 'ta.p.progena') return op ? Math.min(op.maxWounds - op.wounds, 4) * 0.55 : 0
  if (p.ployId === 'ta.e.drop-augury') return view.turningPoint <= 1 ? s : 0.3
  switch (p.ployId) {
    case 'fg.e.gore-marks':
      return goreMarksScore(view, p)
    case 'fg.x.violent-temperament': {
      // re-roll every die: worth it when the fighter has more fails than successes on the table
      const seq = view.attack?.seq
      const side = seq ? [seq.atk, seq.def].find((x) => x?.operativeId === p.operativeId) : undefined
      if (!side) return 0
      const wins = side.dice.filter((d) => !d.used && d.kind !== 'fail').length
      const fails = side.dice.filter((d) => !d.used && d.kind === 'fail').length
      return fails > wins ? 1.6 : 0.1
    }
    case 'ha.inv.rejuvenation':
      // D3+1 wounds back: worth what is actually missing
      return op ? Math.min(op.maxWounds - op.wounds, 3) * 0.55 : s
    case 'ha.omen': {
      // an enemy re-rolls its 6s (best on the one that hits hardest); a friend re-rolls its 1s
      const t = p.param ? view.operatives[p.param] : undefined
      if (!t) return s
      return t.seat === seat ? 0.9 + t.wounds * 0.02 : 1.3 + t.maxWounds * 0.03
    }
    case 'ha.flay':
      return p.param && view.operatives[p.param]?.seat === seat ? 1.2 : 0.2
    case 'wc.a.fate-reserve': {
      // param slot:side:rolled value. Trade a rolled die for the reserved one only when it swings the sequence our way:
      // a fail of ours made a success, or a success of the enemy's made a fail
      const [slot, side, rolled] = (p.param ?? '').split(':')
      const fx = view.effects.find((e) => e.source === 'wc.fate' && e.seat === seat)
      const reserved = Array.isArray(fx?.data?.dice) ? (fx!.data!.dice as number[])[Number(slot)] : undefined
      const seq = view.attack?.seq
      const dside = side === 'a' ? seq?.atk : seq?.def
      if (!dside || reserved === undefined) return 0
      const wins = (x: number): number => (x !== 1 && (x >= dside.need || (dside.lethal !== null && x >= dside.lethal)) ? 1 : 0)
      const crits = (x: number): number => (x === 6 || (dside.lethal !== null && x >= dside.lethal) ? 1 : 0)
      const r = Number(rolled)
      const swing = wins(reserved) - wins(r) + 0.4 * (crits(reserved) - crits(r))
      const gain = dside.seat === seat ? swing : -swing
      return gain > 0.3 ? 1.2 + gain : 0
    }
    case 'wc.e.sorcerous-scrolls': {
      // once per battle: swap only for a clearly better boon than the Sorcerer's own
      const value: Record<string, number> = { 'ASTRAL BOMBARDMENT': 1.4, 'ECHOES FROM THE WARP': 1.1, 'INCORPOREAL SIGHT': 1, 'TWIST OF FATE': 1, 'MASTER OF THE IMMATERIUM': 1, 'IMMATERIAL FLIGHT': 0.9, 'TIME-WALK': 0.8, 'MUTANT APPENDAGE': 0.7, 'WARP SWELL': 0.6 }
      const gain = (value[p.param ?? ''] ?? 0) - (value[op?.picks?.boon ?? ''] ?? 0)
      return gain >= 0.5 ? 0.3 + gain : 0
    }
    case 'wc.p.capricious-plan':
      // the flux options also bring the Sorcerer's friend back first, so they are worth a little more than the plain ones
      return p.param === 'order' ? 0.4 : p.param === 'both' ? 1.0 : p.param === 'flux-dash' ? 1.0 : p.param === 'flux-both' ? 1.1 : 0.9
    case 'ss.p.astartes-training': {
      // a second Shoot or Fight for the acting Scout: worth it only when the action has a target in reach (the all-heavy
      // option also needs an AP more than the operative has at APL 2)
      if (!op) return s
      const foes = enemiesOf(view, op).filter((e) => e.status === 'active' && e.wounds > 0)
      const reach = (r: number): boolean => foes.some((e) => distanceBetween(bodyOf(op), bodyOf(e)) <= r)
      const apl = op.apl + Math.max(-1, Math.min(1, op.aplMods))
      if (p.param === 'fight') return reach(2.5) ? 1.6 : 0.2
      if (p.param === 'heavy') return apl >= 3 && reach(14) ? 1.5 : 0
      return reach(12) ? 1.7 : 0.3
    }
    case 'ph.p.patient-ambush': {
      // skip this activation: sensible when the enemy has more operatives ready, so the order of activations stays level and
      // they commit first; pointless while we hold the numbers
      const mine = seatOps(view, seat as 'A' | 'B').filter((o) => o.status === 'active' && o.ready).length
      const theirs = enemiesOf(view, { seat: seat as 'A' | 'B' }).filter((o) => o.status === 'active' && o.ready).length
      const diff = theirs - mine
      return diff >= 1 ? 0.9 + 0.2 * Math.min(diff, 3) : diff === 0 && view.turningPoint >= 2 ? 0.5 : 0
    }
    case 'wc.p.psychic-cabal':
      // a second PSYCHIC gun beats a borrowed action
      return (p.param ?? '').includes(':w:') ? s + 0.3 : s - 0.3
    case 'ha.fdd': {
      const t = p.param ? view.operatives[p.param] : undefined
      return t ? 1.2 + t.wounds * 0.03 : s
    }
    case 'nb.p.lock-it-down': {
      // the objective nearest the operative that will hold it
      const m = p.param ? view.markers.find((k) => k.id === p.param) : undefined
      if (!m || !op) return s
      return s - Math.min(Math.hypot(op.pos.x - m.pos.x, op.pos.z - m.pos.z), 20) * 0.05
    }
    case 'nv.a.guidance':
    case 'nv.a.blessing':
    case 'nv.a.intervention':
    case 'nv.e.sanctified-rounds':
      return faithScore(view, seat, p)
    case 'nv.a.blaze-token':
      // shedding the burn costs 1 APL for the activation: not worth it in the last turning point
      return view.turningPoint >= 4 ? 0 : s
    case 'nv.p.glorious-martyrdom': {
      // 1 Faith and D3 damage for every enemy beside the fallen operative
      const near = op ? enemiesOf(view, op).filter((e) => e.status === 'active' && distanceBetween(bodyOf(op), bodyOf(e)) <= 2).length : 0
      return near > 0 ? s + near * 0.4 : 0
    }
    case 'cc.p.abhorrent-mutation': {
      // the gift pick follows the fixed preference of the team picks (Chitinous first)
      const i = ['chitinous', 'fleet', 'sinewed', 'horned', 'barbed', 'deformed-wings'].indexOf(p.param ?? '')
      return i < 0 ? 0 : 1.9 - 0.15 * i
    }
    case 'cc.a.attuned-in-purpose':
      return (p.param ?? '').endsWith(':engage') ? s : 0.2
    case 'cc.a.gift-horned': {
      const e = p.param ? view.operatives[p.param] : undefined
      return e && e.wounds <= 1 ? s + 0.6 : s
    }
    case 'cc.p.frenzied-demise': {
      const e = p.param ? view.operatives[p.param] : undefined
      return e ? s + Math.min(e.wounds, 3) * 0.1 : s
    }
    case 'cc.p.unleash-the-daemon':
      // two Fights for the price of one AP: only with an enemy in reach
      return op && enemiesOf(view, op).some((e) => e.status === 'active' && distanceBetween(bodyOf(op), bodyOf(e)) <= 2.5) ? s : 0.3
    case 'hc.p.omnissiahs-imperative':
      // the extra rule helps most once the dice are in play
      return windowId === 'firefight.activationStart' || windowId === 'firefight.actionDeclared' ? s - 0.4 : s
    case 'bl.p.dark-favour': {
      // the shot goes to a healthier friend: only when the holder is badly hurt and the stand-in has more wounds
      const sub = p.param ? view.operatives[p.param] : undefined
      return op && sub && op.wounds * 2 <= op.maxWounds && sub.wounds > op.wounds ? 1.4 : 0
    }
    case 'bl.a.shielding': {
      // Move 2 inches less for defence re-rolls: worth it when an enemy is near enough to shoot, not when the sweeper will charge
      if (!op) return 0
      return enemiesOf(view, op).some((e) => e.status === 'active' && e.wounds > 0 && distanceBetween(bodyOf(op), bodyOf(e)) <= 12 && distanceBetween(bodyOf(op), bodyOf(e)) > 3) ? 1.0 : 0
    }
    default:
      return s
  }
}

/**
 * Fellgor Ravagers, Gnarlscar's Sagacious: it flips the order as its activation ends. It has just acted, so Engage buys
 * nothing until its next activation (which picks a fresh order); Conceal in cover is what keeps it alive. Flip when the
 * engine's own threat estimate drops by a clear margin.
 */
function sagaciousScore(ctx: AiCtx, opId: string | undefined): number {
  const me = opId ? ctx.view.operatives[opId] : undefined
  if (!me || me.status !== 'active') return 0
  const to = me.order === 'engage' ? 'conceal' : 'engage'
  const now = threatAt(ctx, ctx.view, me).expected
  const after = threatAt(ctx, withOrder(ctx.view, me.id, to), withOrder(ctx.view, me.id, to).operatives[me.id]!).expected
  // the margin is in expected wounds: a clear reduction is worth the free flip. Going to Conceal costs nothing even when the
  // estimate sees no danger (the next activation picks its own order, and a Conceal operative in cover cannot be shot at), so
  // that flip is taken unless it would raise the threat; Engage is never worth it once the activation is over.
  if (now - after >= 0.25) return 0.3 + Math.min(1, now - after)
  return to === 'conceal' && after <= now + 0.05 ? 0.35 : 0
}

/**
 * Fellgor Ravagers, Gore Marks: 1 damage to the fighter, then re-roll one attack die; a re-roll that fails costs 1 more.
 * Worth it only for a failed die with decent odds on a fighter that is not close to Frenzy.
 */
function goreMarksScore(view: GameState, p: { operativeId?: string; param?: string }): number {
  const seq = view.attack?.seq
  const op = p.operativeId ? view.operatives[p.operativeId] : undefined
  const i = Number(p.param)
  if (!seq || !op || !Number.isInteger(i) || op.wounds < 5) return 0
  const side = [seq.atk, seq.def].find((x) => x?.operativeId === op.id)
  const die = side?.dice[i]
  if (!side || !die || die.kind !== 'fail' || die.used) return 0
  const w = side.weaponId ? view.data.weapons[side.weaponId] : undefined
  if (!w) return 0
  const hit = 1 - dieOdds(side.need, side.lethal ?? undefined).fail
  const gain = hit * avgDmg(w.dmg) * 0.9
  const cost = (1 + (1 - hit)) * 0.8
  return gain - cost > 0.3 ? gain - cost : 0
}

/** ploy.firefight: use the best offered ploy when the window's swing is positive, else pass. Free (0 CP) offers need little. */
export function firefightPloy(ctx: AiCtx): Action {
  const { pending, view } = ctx
  const cp = view.players[ctx.seat].cp
  const info = (view.window?.info ?? {}) as { attackFails?: number; defenceFails?: number; critRetained?: boolean }
  let best: { o: DecisionOption; margin: number } | null = null
  for (const o of pending.options ?? []) {
    const p = o.action.payload as { ployId: string; param?: string; operativeId?: string }
    const cost = Number(o.data?.cost ?? 1)
    if (cost > cp) continue
    let s = p.ployId === 'fg.x.sagacious' ? sagaciousScore(ctx, p.operativeId) : ployScore(view, ctx.seat, p, String(pending.window ?? ''))
    // defensive dice ploys matter when the attack is heavy; offensive ones when the swing is open
    if (pending.window === 'shoot.defenceRolled' && (info.attackFails ?? 0) > 3) s *= 0.7
    if (!ctx.params.tacAware && cost > 0) s *= 0.6
    // a free offer costs nothing but its usage limit, so the bar is low; paid ploys keep the threshold for the CP left
    const need = cost <= 0 ? 0.3 : threshold(cp) - 0.3
    const margin = s - need
    if (margin >= 0 && (!best || margin > best.margin)) best = { o, margin }
  }
  return best ? best.o.action : passAction(pending)
}

export type { Operative }
