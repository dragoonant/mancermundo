// FGT: fight.* - the Fight sequence (R-6). The attacker picks an enemy in its Control Range, both
// fighters pick a melee weapon, both roll at once (assists improve Hit), re-roll in alternation
// (R-6.4), then strike and block one die at a time, attacker first (R-6.5), until the dice run out
// or a fighter is incapacitated (R-6.7).
import {
  applyAplEffect,
  applyReroll,
  attackOf,
  attackStats,
  countKinds,
  inflict,
  kindsOf,
  newSide,
  openWindow,
  runDiceRolled,
  parseReroll,
  pushRetained,
  pushRolled,
  registerResumer,
  beginRemovals,
  rerollOptions,
  retainAttack,
  ruleSetFor,
  seqOf,
  valuesOf,
  weaponDamage,
  weaponOf,
  weaponUnusable,
} from './attack-common'
import { providerAfterResolution, providerBlockCapacity, providerFightStart, providerFightTargets, providerFightWeapons } from './team-rules'
import { normalBlocksCrit } from './teams/angels-of-death'
import { cancelAction, finishAction } from './firefight'
import { runHook } from './hooks'
import { bodyOf, visible } from './los'
import { distanceBetween, enemiesInControlRange, inControlRange } from './measure'
import { reject, type Ctx, type Handled, type ModuleDef, type OptionInput } from './registry'
import { activeOps, getOp, otherSeat } from './state'
import type {
  Action,
  Activation,
  AttackDie,
  AttackSequence,
  DiceSide,
  GameState,
  Operative,
  PendingDecision,
  Rejection,
  Seat,
  TimingWindowId,
} from './types'

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export function meleeWeapons(state: GameState, op: Operative): string[] {
  return op.weapons.filter((w) => state.data.weapons[w]?.type === 'melee' && weaponUnusable(state, op, w, [], 'fight') === null)
}

/** Melee weapons plus the weapons team rules let it fight or retaliate with (Point-Blank Fusillade's ranged profile). */
export function fightWeapons(state: GameState, op: Operative, retaliating: boolean): string[] {
  const out = meleeWeapons(state, op)
  for (const w of providerFightWeapons(state, op, retaliating)) if (op.weapons.includes(w) && !out.includes(w)) out.push(w)
  return out
}

export function fightAvailability(state: GameState, op: Operative, _activation: Activation | null): Rejection | null {
  if (fightWeapons(state, op, false).length === 0) return { code: 'E_ACTION_RESTRICTED', reason: 'the operative has no melee weapon' }
  const foes = enemiesInControlRange(state, op, op.seat).filter((e) => e.wounds > 0)
  if (foes.length === 0) return { code: 'E_ACTION_RESTRICTED', reason: 'Fight needs an enemy in control range' }
  return null
}

/**
 * Assisting friends of `fighter` in a fight against `foe` (R-6.3): in the foe's control range and not in
 * the control range of any other enemy operative.
 */
export function assistersOf(state: GameState, fighter: Operative, foe: Operative): string[] {
  const out: string[] = []
  for (const o of activeOps(state)) {
    if (o.seat !== fighter.seat || o.id === fighter.id || o.wounds <= 0) continue
    if (!inControlRange(state, bodyOf(o), bodyOf(foe))) continue
    const enemies = enemiesInControlRange(state, o, o.seat).filter((e) => e.wounds > 0)
    if (enemies.length === 1 && enemies[0]!.id === foe.id) out.push(o.id)
  }
  return out.sort()
}

// ---------------------------------------------------------------------------
// Begin
// ---------------------------------------------------------------------------

export function beginFight(ctx: Ctx): void {
  const s = ctx.state
  const act = s.firefight.activation!
  const op = getOp(s, act.operativeId)
  s.attack = {
    kind: 'fight',
    stage: 'fightTarget',
    operativeId: op.id,
    seat: op.seat,
    weaponId: null,
    pointBlank: false,
    targets: [],
    candidates: [],
    index: 0,
    seq: null,
    incapacitated: [],
    stunned: [],
    inherit: null,
    windows: [],
  }
  const inCr = enemiesInControlRange(s, op, op.seat).filter((e) => e.wounds > 0)
  if (inCr.length === 0 || meleeWeapons(s, op).length === 0) {
    s.attack = null
    cancelAction(ctx)
    return
  }
  // M9 batch C: team rules may narrow the choice (Bad-tempered: the Hound makes itself the one to fight); never empty
  const allowed = providerFightTargets(s, op, inCr.map((e) => e.id))
  const foes = inCr.filter((e) => allowed.includes(e.id))
  ctx.raise({
    kind: 'fight.target',
    seat: op.seat,
    window: 'firefight.actionDeclared',
    context: { operativeId: op.id },
    options: foes.map((e) => ({
      id: e.id,
      labelKey: 'fight.target',
      type: 'fight.target' as const,
      payload: { targetId: e.id },
      data: { wounds: e.wounds, maxWounds: e.maxWounds, distance: distanceBetween(bodyOf(op), bodyOf(e)) },
    })),
    canPass: true,
  })
}

type Step = (ctx: Ctx) => void
const STEPS: Record<string, Step> = {}

function proceed(ctx: Ctx, step: string, window?: TimingWindowId): void {
  const a = attackOf(ctx)
  if (window && openWindow(ctx, window, a.fight?.targetId ?? '')) {
    a.resume = step
    return
  }
  STEPS[step]!(ctx)
}

registerResumer('fight', (ctx) => {
  const a = ctx.state.attack
  if (!a?.resume) return
  const step = a.resume
  a.resume = undefined
  STEPS[step]!(ctx)
})

function chooseTarget(ctx: Ctx, targetId: string): void {
  const a = attackOf(ctx)
  a.targets = [targetId]
  a.fight = { targetId, weaponA: null, weaponD: null, turn: a.seat, passes: 0, shockUsed: { A: false, B: false } }
  pickWeapon(ctx, 'A')
}

/** Weapon choice for the attacker (side 'A' here means the active operative) then the retaliator. */
function pickWeapon(ctx: Ctx, who: 'A' | 'D'): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const f = a.fight!
  const fighter = getOp(s, who === 'A' ? a.operativeId : f.targetId)
  if (who === 'D' && (fighter.flags.cannotRetaliate === true)) {
    f.weaponD = null
    proceed(ctx, 'roll', 'fight.weaponsSelected')
    return
  }
  const weapons = fightWeapons(s, fighter, who === 'D')
  if (weapons.length === 0) {
    if (who === 'A') f.weaponA = null
    else f.weaponD = null
    if (who === 'A') pickWeapon(ctx, 'D')
    else proceed(ctx, 'roll', 'fight.weaponsSelected')
    return
  }
  if (weapons.length === 1) {
    // no real choice: the single melee weapon is used
    if (who === 'A') f.weaponA = weapons[0]!
    else f.weaponD = weapons[0]!
    if (who === 'A') pickWeapon(ctx, 'D')
    else proceed(ctx, 'roll', 'fight.weaponsSelected')
    return
  }
  a.stage = 'fightWeapon'
  ctx.raise({
    kind: 'fight.weapon',
    seat: fighter.seat,
    window: 'fight.weaponsSelected',
    context: { operativeId: fighter.id, retaliating: who === 'D' },
    options: weapons.map((w) => {
      const def = weaponOf(s, w)
      return {
        id: w,
        labelKey: 'fight.weapon',
        type: 'fight.weapon' as const,
        payload: { weaponId: w },
        data: { name: def.name, atk: def.atk, hit: def.hit, dmg: def.dmg, rules: def.rules },
      }
    }),
  })
}

function sideFor(ctx: Ctx, seat: Seat): DiceSide | null {
  const seq = ctx.state.attack?.seq
  if (!seq) return null
  if (seq.atk.seat === seat) return seq.atk
  if (seq.def && seq.def.seat === seat) return seq.def
  return null
}

STEPS.roll = (ctx) => {
  const s = ctx.state
  const a = attackOf(ctx)
  const f = a.fight!
  const attacker = getOp(s, a.operativeId)
  const defender = getOp(s, f.targetId)
  const aAssists = f.weaponA ? assistersOf(s, attacker, defender) : []
  const dAssists = f.weaponD ? assistersOf(s, defender, attacker) : []
  ctx.emit({ type: 'FightStarted', operativeId: attacker.id, targetId: defender.id, attackerWeapon: f.weaponA, defenderWeapon: f.weaponD }, attacker.seat)
  a.weaponId = f.weaponA
  const mk = (op: Operative, foe: Operative, weaponId: string | null, assists: string[]): DiceSide | null => {
    if (!weaponId) return null
    const stats = attackStats(s, op.id, weaponId, foe.id, { kind: 'fight', assists }, ctx)
    const side = newSide(op.seat, op.id, weaponId, stats.need, stats.lethal, stats.grants)
    const rolled = stats.atk - stats.accurate
    if (rolled > 0) pushRolled(side, ctx.roll(op.id === attacker.id ? 'fight.attack' : 'fight.defence', rolled))
    pushRetained(side, stats.accurate, 'normal', 'accurate')
    ctx.emit(
      {
        type: 'AttackDiceRolled',
        operativeId: op.id,
        targetId: foe.id,
        weaponId,
        dice: valuesOf(side.dice),
        kinds: kindsOf(side.dice),
        need: side.need,
        lethal: side.lethal,
      },
      op.seat,
    )
    return side
  }
  // both players roll simultaneously: the attacker's dice come first, then the retaliator's
  const atk = mk(attacker, defender, f.weaponA, aAssists)
  const def = mk(defender, attacker, f.weaponD, dAssists)
  const seq: AttackSequence = {
    targetId: defender.id,
    secondary: false,
    cover: false,
    obscured: false,
    improvedCover: false,
    atk: atk ?? newSide(attacker.seat, attacker.id, null, 6, null, []),
    def,
    critRetained: false,
    collected: 0,
    choices: {},
  }
  a.seq = seq
  f.passes = 0
  f.turn = s.initiative ?? attacker.seat
  // M9 batch B: rules acting on the fresh rolls (Omen)
  if (atk) runDiceRolled(ctx, 'fight', 'attack', atk, defender.id)
  if (def) runDiceRolled(ctx, 'fight', 'defence', def, attacker.id)
  // M9 shared: both fighters' window on the fresh rolls, before any re-roll (Curse of Rot)
  proceed(ctx, 'rerolls', 'fight.beforeRerolls')
}

STEPS.rerolls = (ctx) => startTurn(ctx)

// --- alternating re-rolls (R-6.4, R-9.3) ------------------------------------

function startTurn(ctx: Ctx): void {
  const a = attackOf(ctx)
  const f = a.fight!
  const side = sideFor(ctx, f.turn)
  if (side) side.phase = 'grants'
  a.stage = 'fightReroll'
  rerollStep(ctx)
}

function switchTurn(ctx: Ctx): void {
  const f = attackOf(ctx).fight!
  f.turn = otherSeat(f.turn)
  startTurn(ctx)
}

function rerollStep(ctx: Ctx): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const f = a.fight!
  if (f.passes >= 2) {
    proceed(ctx, 'afterRolls', 'fight.rolled')
    return
  }
  const side = sideFor(ctx, f.turn)
  if (!side) {
    f.passes++
    switchTurn(ctx)
    return
  }
  const seq = seqOf(ctx)
  for (let guard = 0; guard < 4; guard++) {
    if (side.phase === 'grants') {
      const o = rerollOptions(s, side)
      if (o.grants.length > 0) {
        ctx.raise({
          kind: 'dice.reroll',
          seat: side.seat,
          window: 'fight.rolled',
          context: { side: side === seq.atk ? 'attacker' : 'defender', dice: valuesOf(side.dice), kinds: kindsOf(side.dice), enemy: kindsOf(side === seq.atk ? (seq.def?.dice ?? []) : seq.atk.dice) },
          options: o.grants,
          canPass: true,
        })
        return
      }
      side.phase = 'command'
    }
    if (side.phase === 'command') {
      const o = rerollOptions(s, side)
      if (o.command.length > 0) {
        ctx.raise({
          kind: 'dice.commandReroll',
          seat: side.seat,
          window: 'fight.rolled',
          context: { side: side === seq.atk ? 'attacker' : 'defender', dice: valuesOf(side.dice), kinds: kindsOf(side.dice), cp: s.players[side.seat].cp },
          options: o.command,
          canPass: true,
        })
        return
      }
      side.phase = 'done'
    }
    break
  }
  // this seat passes
  f.passes++
  switchTurn(ctx)
}

STEPS.afterRolls = (ctx) => {
  const s = ctx.state
  const a = attackOf(ctx)
  const f = a.fight!
  const seq = seqOf(ctx)
  const attacker = getOp(s, a.operativeId)
  const defender = getOp(s, f.targetId)
  const sides: { side: DiceSide; op: Operative; foe: Operative; label: 'attack' | 'defence' }[] = [{ side: seq.atk, op: attacker, foe: defender, label: 'attack' }]
  if (seq.def) sides.push({ side: seq.def, op: defender, foe: attacker, label: 'defence' })
  for (const e of sides) {
    if (!e.side.weaponId) continue
    runHook('afterAttackRoll', {
      seat: e.op.seat,
      state: s,
      engine: ctx,
      operativeId: e.op.id,
      targetId: e.foe.id,
      weaponId: e.side.weaponId,
      data: { kind: 'fight', side: e.label, targetId: e.foe.id, dice: e.side.dice, requests: [], choices: seq.choices },
    })
  }
  // retention for both fighters (no cover, no obscured)
  for (const e of sides) {
    if (!e.side.weaponId) continue
    const rules = ruleSetFor(s, e.op, e.side.weaponId, 'fight', e.foe.id, ctx)
    const out = retainAttack(e.side, rules, false)
    const c = countKinds(e.side.dice)
    ctx.emit({ type: 'AttackRetained', operativeId: e.op.id, targetId: e.foe.id, normal: c.normal, crit: c.crit, obscured: false, converted: out.converted }, e.op.seat)
    if (out.critRetained && rules.stun && !a.stunned.includes(e.foe.id)) a.stunned.push(e.foe.id)
  }
  // Devastating is immediate damage on the fighter attacked
  for (const e of sides) {
    if (!e.side.weaponId) continue
    const rules = ruleSetFor(s, e.op, e.side.weaponId, 'fight', e.foe.id, ctx)
    if (!rules.devastating || rules.devastating.x <= 0) continue
    const crits = countKinds(e.side.dice).crit
    for (let i = 0; i < crits; i++) {
      inflict(ctx, { targetId: e.foe.id, attackerId: e.op.id, weaponId: e.side.weaponId, amount: rules.devastating.x, source: 'devastating' })
    }
  }
  a.stage = 'resolve'
  f.turn = attacker.seat
  STEPS.resolve!(ctx)
}

// --- strike and block (R-6.5 to R-6.7) --------------------------------------

function unresolved(side: DiceSide | null): number[] {
  if (!side) return []
  const out: number[] = []
  side.dice.forEach((d, i) => {
    if (!d.used && d.kind !== 'fail') out.push(i)
  })
  return out
}

function firstOfKind(side: DiceSide, idx: number[], kind: AttackDie['kind']): number | null {
  for (const i of idx) if (side.dice[i]!.kind === kind) return i
  return null
}

function fighterGone(ctx: Ctx): boolean {
  const a = attackOf(ctx)
  const f = a.fight!
  return getOp(ctx.state, a.operativeId).wounds <= 0 || getOp(ctx.state, f.targetId).wounds <= 0
}

function weaponDmg(ctx: Ctx, side: DiceSide): { normal: number; crit: number } {
  const a = attackOf(ctx)
  const foeId = side.operativeId === a.operativeId ? a.fight!.targetId : a.operativeId
  return weaponDamage(ctx.state, side.operativeId, side.weaponId!, foeId, 'fight', ctx)
}

function strike(ctx: Ctx, mine: DiceSide, theirs: DiceSide | null, i: number): void {
  const s = ctx.state
  const a = attackOf(ctx)
  const f = a.fight!
  const die = mine.dice[i]!
  const foeId = mine.operativeId === a.operativeId ? f.targetId : a.operativeId
  const dmg = weaponDmg(ctx, mine)
  const data = { die: die.kind, amount: die.kind === 'crit' ? dmg.crit : dmg.normal, cancel: false }
  runHook('beforeStrike', { seat: mine.seat, state: s, engine: ctx, operativeId: mine.operativeId, targetId: foeId, ...(mine.weaponId ? { weaponId: mine.weaponId } : {}), data })
  die.used = true
  if (!data.cancel) {
    const dealt = inflict(ctx, {
      targetId: foeId,
      attackerId: mine.operativeId,
      weaponId: mine.weaponId,
      amount: data.amount,
      source: die.kind === 'crit' ? 'strike-crit' : 'strike-normal',
    })
    ctx.emit({ type: 'Struck', operativeId: mine.operativeId, targetId: foeId, die: die.kind === 'crit' ? 'crit' : 'normal', amount: dealt }, mine.seat)
  }
  // Shock (R-10.20): the first crit strike also discards an unresolved enemy success
  if (die.kind === 'crit' && !f.shockUsed[mine.seat] && theirs && mine.weaponId) {
    const op = getOp(s, mine.operativeId)
    const rules = ruleSetFor(s, op, mine.weaponId, 'fight', foeId, ctx)
    if (rules.shock) {
      f.shockUsed[mine.seat] = true
      const idx = unresolved(theirs)
      const pick = firstOfKind(theirs, idx, 'normal') ?? firstOfKind(theirs, idx, 'crit')
      if (pick !== null) {
        const kind = theirs.dice[pick]!.kind
        theirs.dice[pick]!.used = true
        ctx.emit({ type: 'ShockDiscard', operativeId: mine.operativeId, discarded: kind === 'crit' ? 'crit' : 'normal' }, mine.seat)
      }
    }
  }
}

/**
 * M9 batch B: one strike out of the normal alternation (Unending Bloodshed, Brawler): the fighter of `seat` strikes
 * with its unresolved success `die` through the normal strike path (beforeStrike, modifyDamage, the victim's
 * per-die reductions, Shock). Usable while the fight sequence is live, e.g. from a ploy in the fight.resolved window or
 * a beforeIncapacitated hook; works even when that fighter is at 0 wounds. False when there is no such die.
 */
export function extraStrike(ctx: Ctx, seat: Seat, die: number): boolean {
  const a = ctx.state.attack
  if (!a || a.kind !== 'fight' || !a.seq) return false
  const seq = a.seq
  const mine = seq.atk.seat === seat && seq.atk.weaponId ? seq.atk : seq.def && seq.def.seat === seat ? seq.def : null
  if (!mine || !mine.weaponId) return false
  const d = mine.dice[die]
  if (!d || d.used || d.kind === 'fail') return false
  strike(ctx, mine, mine === seq.atk ? seq.def : seq.atk, die)
  return true
}

/** Can a die of `mine` block a die of `kind` when the enemy weapon is `brutal`? */
function canBlock(mine: AttackDie['kind'], theirs: AttackDie['kind'], brutal: boolean, normalCrit = false): boolean {
  if (brutal && mine !== 'crit') return false
  if (mine === 'crit') return theirs !== 'fail'
  return mine === 'normal' && (theirs === 'normal' || (theirs === 'crit' && normalCrit))
}

function isBrutal(ctx: Ctx, side: DiceSide | null, foeId: string): boolean {
  if (!side?.weaponId) return false
  const op = getOp(ctx.state, side.operativeId)
  return ruleSetFor(ctx.state, op, side.weaponId, 'fight', foeId, ctx).brutal
}

STEPS.resolve = (ctx) => {
  const s = ctx.state
  const a = attackOf(ctx)
  const f = a.fight!
  const seq = seqOf(ctx)
  const attackerSide = seq.atk.weaponId ? seq.atk : null
  const defenderSide = seq.def
  // M9 prep: team rules may change who resolves first, owe out-of-turn resolutions or bar blocking (team-rules.ts)
  if (!f.started) {
    f.started = true
    const start = providerFightStart(s, a)
    if (start.first) f.turn = start.first
    if (start.queue.length > 0) f.queue = start.queue.map((q) => ({ ...q }))
    if (start.noBlock.length > 0) f.noBlock = start.noBlock
  }
  for (let guard = 0; guard < 40; guard++) {
    if (fighterGone(ctx)) break
    const ua = unresolved(attackerSide)
    const ud = unresolved(defenderSide)
    if (ua.length === 0 && ud.length === 0) break
    // an owed resolution goes first; it is dropped when its side has nothing it could do
    const owed = f.queue?.[0]
    if (owed && ua.length > 0 && ud.length > 0) {
      const side = attackerSide && attackerSide.seat === owed.seat ? attackerSide : defenderSide
      if (!side || unresolved(side).length === 0) {
        f.queue!.shift()
        continue
      }
      if (owed.resume === undefined) owed.resume = f.turn
      f.turn = owed.seat
    }
    // one side out of dice: the other resolves everything left (R-6.6); blocking nothing is pointless, so strike
    if (ua.length === 0 || ud.length === 0) {
      const mine = ua.length > 0 ? attackerSide! : defenderSide!
      const theirs = ua.length > 0 ? defenderSide : attackerSide
      // crits first
      const order = (ua.length > 0 ? ua : ud).slice().sort((x, y) => (mine.dice[y]!.kind === 'crit' ? 1 : 0) - (mine.dice[x]!.kind === 'crit' ? 1 : 0))
      for (const i of order) {
        if (fighterGone(ctx)) break
        if (mine.dice[i]!.used) continue
        strike(ctx, mine, theirs, i)
      }
      break
    }
    const mineSeat = f.turn
    const mine = attackerSide && attackerSide.seat === mineSeat ? attackerSide : defenderSide!
    const theirs = mine === attackerSide ? defenderSide! : attackerSide!
    const myIdx = mine === attackerSide ? ua : ud
    const theirIdx = mine === attackerSide ? ud : ua
    const options: OptionInput[] = []
    const foeId = theirs.operativeId
    const dmg = weaponDmg(ctx, mine)
    const theirBrutal = isBrutal(ctx, theirs, mine.operativeId)
    const duelist = normalBlocksCrit(s, mine.operativeId, theirBrutal)
    const blockOnly = owed?.resume !== undefined && owed.seat === mine.seat && owed.blockOnly === true
    // M9 batch C: an owed resolution that must be a strike (Stealth Attack)
    const strikeOnly = owed?.resume !== undefined && owed.seat === mine.seat && owed.strikeOnly === true
    const noBlock = (f.noBlock ?? []).includes(mine.seat) || strikeOnly
    for (const kind of ['crit', 'normal'] as const) {
      const i = firstOfKind(mine, myIdx, kind)
      if (i === null) continue
      if (!blockOnly) options.push({
        id: `strike:${i}`,
        labelKey: 'fight.strike',
        type: 'fight.resolve',
        payload: { op: 'strike', die: i },
        data: { die: kind, damage: kind === 'crit' ? dmg.crit : dmg.normal },
      })
      for (const tk of ['crit', 'normal'] as const) {
        const j = firstOfKind(theirs, theirIdx, tk)
        if (noBlock || j === null || !canBlock(kind, tk, theirBrutal, duelist)) continue
        options.push({
          id: `block:${i}->${j}`,
          labelKey: 'fight.block',
          type: 'fight.resolve',
          payload: { op: 'block', die: i, against: j },
          data: { die: kind, against: tk },
        })
      }
      // M9 batch B: a block that cancels two successes (Tangle): every pair of blockable kinds
      if (!noBlock && providerBlockCapacity(s, a, mine.seat, i) >= 2) {
        const pairs: [AttackDie['kind'], AttackDie['kind']][] = [['crit', 'crit'], ['crit', 'normal'], ['normal', 'normal']]
        for (const [k1, k2] of pairs) {
          if (!canBlock(kind, k1, theirBrutal, duelist) || !canBlock(kind, k2, theirBrutal, duelist)) continue
          const of1 = theirIdx.filter((x) => theirs.dice[x]!.kind === k1)
          const of2 = theirIdx.filter((x) => theirs.dice[x]!.kind === k2)
          const j = of1[0]
          const k = k1 === k2 ? of1[1] : of2[0]
          if (j === undefined || k === undefined) continue
          options.push({
            id: `block2:${i}->${j},${k}`,
            labelKey: 'fight.blockTwo',
            type: 'fight.resolve',
            payload: { op: 'block', die: i, against: j, against2: k },
            data: { die: kind, against: k1, against2: k2 },
          })
        }
      }
    }
    if (options.length === 0) {
      // an owed block-only resolution with nothing it could block is skipped
      if (owed?.resume !== undefined) {
        f.turn = owed.resume
        f.queue!.shift()
        continue
      }
    }
    a.stage = 'resolve'
    ctx.raise({
      kind: 'fight.resolve',
      seat: mine.seat,
      window: 'fight.resolved',
      context: {
        operativeId: mine.operativeId,
        foeId,
        mine: kindsOf(mine.dice).map((k, i) => (myIdx.includes(i) ? k : null)),
        theirs: kindsOf(theirs.dice).map((k, i) => (theirIdx.includes(i) ? k : null)),
        myWounds: getOp(s, mine.operativeId).wounds,
        foeWounds: getOp(s, foeId).wounds,
      },
      options,
    })
    return
  }
  proceed(ctx, 'finish', 'fight.resolved')
}

function handleResolve(state: GameState, action: Action): Handled {
  if (action.type !== 'fight.resolve') return reject('E_WRONG_DECISION', 'expected a strike or block')
  const p = action.payload
  const i = Number(p.die)
  const against = p.against === undefined ? null : Number(p.against)
  const against2 = (p as { against2?: unknown }).against2 === undefined ? null : Number((p as { against2?: unknown }).against2)
  const isBlock = p.op === 'block'
  void state
  return {
    run(ctx) {
      const s = ctx.state
      const a = attackOf(ctx)
      const f = a.fight!
      const seq = seqOf(ctx)
      const mine = seq.atk.seat === f.turn && seq.atk.weaponId ? seq.atk : seq.def!
      const theirs = mine === seq.atk ? seq.def! : seq.atk
      if (isBlock && against !== null) {
        const kind = mine.dice[i]!.kind
        const tk = theirs.dice[against]!.kind
        mine.dice[i]!.used = true
        theirs.dice[against]!.used = true
        ctx.emit({ type: 'Blocked', operativeId: mine.operativeId, die: kind === 'crit' ? 'crit' : 'normal', against: tk === 'crit' ? 'crit' : 'normal' }, mine.seat)
        const cancelled: AttackDie['kind'][] = [tk]
        // M9 batch B: the same die cancels a second success (Tangle)
        if (against2 !== null && theirs.dice[against2] && !theirs.dice[against2]!.used) {
          const tk2 = theirs.dice[against2]!.kind
          theirs.dice[against2]!.used = true
          cancelled.push(tk2)
          ctx.emit({ type: 'Blocked', operativeId: mine.operativeId, die: kind === 'crit' ? 'crit' : 'normal', against: tk2 === 'crit' ? 'crit' : 'normal' }, mine.seat)
        }
        // M9 batch C: rules that act on a block (Riposte)
        runHook('afterBlock', { seat: mine.seat, state: s, engine: ctx, operativeId: mine.operativeId, targetId: theirs.operativeId, ...(mine.weaponId ? { weaponId: mine.weaponId } : {}), data: { die: kind, against: cancelled, weaponId: mine.weaponId } })
      } else {
        strike(ctx, mine, theirs, i)
      }
      void s
      const owed = f.queue?.[0]
      const resolvedBy = f.turn
      if (owed && owed.resume !== undefined && owed.seat === f.turn) {
        // an owed resolution does not move the alternation on
        f.turn = owed.resume
        f.queue!.shift()
      } else f.turn = otherSeat(f.turn)
      const more = providerAfterResolution(s, a, resolvedBy, isBlock && against !== null ? 'block' : 'strike')
      if (more.length > 0) f.queue = [...more.map((q) => ({ ...q })), ...(f.queue ?? [])]
      STEPS.resolve!(ctx)
    },
  }
}

STEPS.finish = (ctx) => {
  const s = ctx.state
  const a = attackOf(ctx)
  const f = a.fight!
  const seq = seqOf(ctx)
  const attacker = getOp(s, a.operativeId)
  const defender = getOp(s, f.targetId)
  const act = s.firefight.activation!
  // limited melee weapons count one use per fight
  for (const side of [seq.atk, seq.def]) {
    if (!side?.weaponId) continue
    const op = getOp(s, side.operativeId)
    const rules = ruleSetFor(s, op, side.weaponId, 'fight', undefined, ctx)
    if (rules.limited !== null) {
      const uses = (op.usedLimited[side.weaponId] ?? 0) + 1
      op.usedLimited[side.weaponId] = uses
      ctx.emit({ type: 'WeaponLimited', operativeId: op.id, weaponId: side.weaponId, uses }, op.seat)
    }
  }
  for (const id of a.stunned) {
    const t = s.operatives[id]
    if (t && t.status === 'active' && t.wounds > 0) applyAplEffect(ctx, id, -1, 'stun')
  }
  if (f.weaponA) act.weaponsUsed = [...(act.weaponsUsed ?? []), f.weaponA]
  runHook('onFightResolved', {
    seat: attacker.seat,
    state: s,
    engine: ctx,
    operativeId: attacker.id,
    targetId: defender.id,
    data: { attackerId: attacker.id, defenderId: defender.id, attackerIncapacitated: attacker.wounds <= 0, defenderIncapacitated: defender.wounds <= 0 },
  })
  ctx.emit({ type: 'FightEnded', operativeId: attacker.id, targetId: defender.id }, attacker.seat)
  const gone = a.incapacitated.slice()
  s.attack = null
  // M9 batch B: who incapacitated whom, for the killer's operative.killed window
  const killers = Object.fromEntries(gone.map((id) => [id, id === attacker.id ? defender.id : attacker.id]))
  if (!beginRemovals(ctx, gone, killers)) return
  finishAction(ctx)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleTarget(_state: GameState, action: Action): Handled {
  if (action.type === 'pass') {
    return {
      run(ctx) {
        ctx.state.attack = null
        cancelAction(ctx)
      },
    }
  }
  if (action.type !== 'fight.target') return reject('E_WRONG_DECISION', 'expected a fight target')
  const targetId = String(action.payload.targetId)
  return { run: (ctx) => chooseTarget(ctx, targetId) }
}

function handleWeapon(_state: GameState, action: Action, pending: PendingDecision): Handled {
  if (action.type !== 'fight.weapon') return reject('E_WRONG_DECISION', 'expected a weapon')
  const weaponId = String(action.payload.weaponId)
  const retaliating = pending.context.retaliating === true
  return {
    run(ctx) {
      const f = attackOf(ctx).fight!
      if (retaliating) {
        f.weaponD = weaponId
        proceed(ctx, 'roll', 'fight.weaponsSelected')
      } else {
        f.weaponA = weaponId
        pickWeapon(ctx, 'D')
      }
    },
  }
}

/** dice.reroll / dice.commandReroll while a fight is open. */
export function fightReroll(state: GameState, action: Action, pending: PendingDecision): Handled {
  const a = state.attack
  if (!a?.seq || !a.fight) return reject('E_WRONG_DECISION', 'no fight is waiting for a re-roll')
  const side = a.seq.atk.seat === pending.seat && a.seq.atk.weaponId ? a.seq.atk : a.seq.def
  if (!side) return reject('E_WRONG_DECISION', 'that seat has no dice to re-roll')
  if (action.type === 'pass') {
    return {
      run(ctx) {
        const sd = sideFor(ctx, pending.seat)!
        sd.phase = pending.kind === 'dice.reroll' ? 'command' : 'done'
        rerollStep(ctx)
      },
    }
  }
  if (action.type !== 'dice.reroll' && action.type !== 'dice.commandReroll') return reject('E_WRONG_DECISION', 'expected a re-roll')
  const parsed = parseReroll(state, side, action.payload)
  if ('rejection' in parsed) return parsed
  return {
    run(ctx) {
      const sd = sideFor(ctx, pending.seat)!
      applyReroll(ctx, sd, parsed, sd.operativeId === attackOf(ctx).operativeId ? 'attack' : 'defence', 'fight')
      attackOf(ctx).fight!.passes = 0
      switchTurn(ctx)
    },
  }
}

export function fightChoice(ctx: Ctx, choice: string, option: string): void {
  const seq = seqOf(ctx)
  seq.choices[choice] = option
  ctx.emit({ type: 'ChoiceMade', seat: attackOf(ctx).seat, choice, option })
  const a = attackOf(ctx)
  const step = a.resume
  a.resume = undefined
  if (step) STEPS[step]!(ctx)
}

export const fightModule: ModuleDef = {
  id: 'fight',
  namespaces: ['fight'],
  handle(state, action, pending) {
    switch (pending.kind) {
      case 'fight.target':
        return handleTarget(state, action)
      case 'fight.weapon':
        return handleWeapon(state, action, pending)
      case 'fight.resolve':
        return handleResolve(state, action)
      default:
        return reject('E_WRONG_DECISION', `${pending.kind} does not belong to the Fight sequence`)
    }
  },
  explain(state, action, pending): Rejection | null {
    if (pending.kind === 'fight.target' && action.type === 'fight.target') {
      const a = state.attack
      const op = a ? state.operatives[a.operativeId] : undefined
      const t = state.operatives[String(action.payload.targetId)]
      if (!op || !t || t.status !== 'active') return { code: 'E_INVALID_TARGET', reason: 'that operative is not on the killzone' }
      if (t.seat === op.seat) return { code: 'E_INVALID_TARGET', reason: 'cannot fight a friendly operative' }
      if (!visible(state, bodyOf(op), bodyOf(t)) && !visible(state, bodyOf(t), bodyOf(op))) return { code: 'E_NOT_VISIBLE', reason: 'the enemy is not visible' }
      return { code: 'E_CONTROL_RANGE', reason: 'the enemy is not in this operative\'s control range' }
    }
    return null
  },
}
