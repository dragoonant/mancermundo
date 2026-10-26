// Attack-sequence handlers for data-driven and code-driven abilities. Each is registered against a hook
// point of hooks.ts (beforeShootTargetSelect, modifyWeaponRules, modifyAttackDice, ...) and mutates the
// live `data` object of that hook, as documented there. Declarative effects (grantWeaponRule,
// removeWeaponRule, modifyStat) are interpreted generically; the rest belong to a named rule.
import { inflict } from './attack-common'
import { providerExtraCoverSaves, providerStealthy, registerTeamRules } from './team-rules'
import { ruleName } from './bundle'
import { bodyOf, targetVerdict } from './los'
import { distanceBetween, enemiesInControlRange } from './measure'
import { markFired } from './code-hooks'
import { activeTactics, evalCondition, hasAbility, hasKeyword, inScope } from './conditions'
import { addEffect, addTpUse, markUsedBattle, tpUsesOf, usedThisBattle } from './effects'
import { smokeObscures } from './core-hooks'
import { registerHook, type HookContext, type TargetStatusData } from './hooks'
import { isInjured } from './state'
import type {
  Condition,
  Effect,
  GameState,
  Operative,
  RerollGrant,
  RuntimeAbility,
  Seat,
  TargetSpec,
  WeaponRuleRef,
} from './types'

type Data = Record<string, unknown>

function effectList(e: unknown): Effect[] {
  if (!e) return []
  return (Array.isArray(e) ? e : [e]) as Effect[]
}

export const ID = {
  ironHalo: 'aod.a.iron-halo',
  tactic: (n: string) => `aod.a.ct-${n}`,
  purity: 'aod.e.purity-seals',
  tilting: 'aod.e.tilting-shields',
  indomitus: 'aod.p.indomitus',
  skulk: 'kom.p.skulk-about',
  scratch: 'kom.p.just-a-scratch',
  atsknf: 'aod.p.and-they-shall-know-no-fear',
  shockAssault: 'aod.p.shock-assault',
  kunnin: 'kom.p.kunnin-but-brutal',
  combatDoctrine: 'aod.p.combat-doctrine',
  ammo: 'core.e.ammo-cache',
}

// ---------------------------------------------------------------------------
// Sources of declarative effects
// ---------------------------------------------------------------------------

interface Source {
  id: string
  effect: Effect
  when?: Condition
  scope?: TargetSpec
  owner: Seat
}

function sourcesFor(state: GameState, op: Operative): Source[] {
  const out: Source[] = []
  const push = (id: string, e: unknown, when: Condition | undefined, scope: TargetSpec | undefined, owner: Seat) => {
    for (const effect of effectList(e)) out.push({ id, effect, ...(when ? { when } : {}), ...(scope ? { scope } : {}), owner })
  }
  const card = state.data.datacards[op.datacardId]
  const abilityIds = new Set<string>([...(card?.abilities ?? []), ...activeTactics(state, op)])
  const team = state.data.teams[state.players[op.seat].teamId]
  for (const id of team?.factionRules ?? []) abilityIds.add(id)
  for (const id of abilityIds) {
    const d: RuntimeAbility | undefined = state.data.abilities[id]
    if (!d) continue
    if (d.scope && !inScope(state, d.scope, op.seat, op)) continue
    push(d.id, d.effect, d.when, undefined, op.seat)
  }
  for (const eqId of state.players[op.seat].equipment) {
    const e = state.data.equipment?.[eqId]
    if (e?.effect && !e.window) push(e.id, e.effect, e.when, undefined, op.seat)
  }
  for (const fx of state.effects) {
    if (fx.kind !== 'ploy' || fx.seat !== op.seat) continue
    if (fx.operativeId && fx.operativeId !== op.id) continue
    const eff = fx.data?.effect as Effect | undefined
    if (!eff) continue
    if (eff.scope && !inScope(state, eff.scope, op.seat, op)) continue
    out.push({ id: fx.source, effect: eff, owner: op.seat })
  }
  return out
}

function weaponMatches(state: GameState, weaponId: string, filter: { weaponIds?: string[]; weaponType?: string; nameContains?: string; hasRule?: string } | undefined): boolean {
  if (!filter) return true
  const w = state.data.weapons[weaponId]
  if (!w) return false
  if (filter.weaponIds && !filter.weaponIds.includes(weaponId)) return false
  if (filter.weaponType && w.type !== filter.weaponType) return false
  if (filter.nameContains && !w.name.toLowerCase().includes(filter.nameContains.toLowerCase())) return false
  if (filter.hasRule && !w.rules.some((r) => r.rule === ruleName(filter.hasRule!))) return false
  return true
}

function whenOk(state: GameState, s: Source, op: Operative, weaponId: string, action: string, targetId?: string): boolean {
  return evalCondition(s.when, {
    state,
    seat: s.owner,
    subjectId: op.id,
    actorId: op.id,
    weaponId,
    action,
    ...(targetId ? { targetId } : {}),
  })
}

function opOf(c: HookContext): Operative | undefined {
  return c.state && c.operativeId ? c.state.operatives[c.operativeId] : undefined
}

function hasRef(rules: WeaponRuleRef[], name: string): boolean {
  return rules.some((r) => r.rule === name)
}

// ---------------------------------------------------------------------------
// modifyWeaponRules
// ---------------------------------------------------------------------------

function doctrineGrants(state: GameState, op: Operative, kind: string, targetId: string | undefined): boolean {
  const cfg = state.config[op.seat]
  const doctrine = cfg.doctrine
  if (!doctrine || !hasKeyword(state, op, 'ANGEL OF DEATH')) return false
  if (doctrine === 'assault') return kind === 'fight'
  if (kind !== 'shoot' || !targetId || !state.operatives[targetId]) return false
  const d = distanceBetween(bodyOf(op), bodyOf(state.operatives[targetId]!))
  return doctrine === 'devastator' ? d > 6 : d <= 6
}

registerHook(
  'modifyWeaponRules',
  (c) => {
    const op = opOf(c)
    const state = c.state
    if (!op || !state || !c.weaponId) return null
    const data = c.data as { kind: 'shoot' | 'fight'; targetId?: string; rules: WeaponRuleRef[] }
    for (const s of sourcesFor(state, op)) {
      const g = s.effect.grantWeaponRule
      const r = s.effect.removeWeaponRule
      if (g && weaponMatches(state, c.weaponId, g.filter) && whenOk(state, s, op, c.weaponId, data.kind, data.targetId)) {
        const name = ruleName(g.rule)
        if (g.x === undefined && hasRef(data.rules, name)) continue
        const ref: WeaponRuleRef = { rule: name }
        if (g.x !== undefined) ref.x = g.x
        if (g.inches !== undefined) ref.inches = g.inches
        if (g.crits !== undefined) ref.crits = g.crits
        data.rules.push(ref)
        if (s.id.startsWith('aod.a.ct-sharpshooter')) markFired('ctSharpshooter')
      }
      if (r && weaponMatches(state, c.weaponId, r.filter) && whenOk(state, s, op, c.weaponId, data.kind, data.targetId)) {
        const name = ruleName(r.rule)
        for (let i = data.rules.length - 1; i >= 0; i--) if (data.rules[i]!.rule === name) data.rules.splice(i, 1)
      }
    }
    // Combat Doctrine: Balanced under the picked doctrine (T-AOD ploy table)
    if (doctrineGrants(state, op, data.kind, data.targetId) && !hasRef(data.rules, 'balanced')) {
      data.rules.push({ rule: 'balanced' })
      markFired('combatDoctrine')
    }
    const foe = data.targetId ? state.operatives[data.targetId] : undefined
    if (foe) {
      // Camo Cloak: shooters ignore Saturate (T-AOD.13)
      if (data.kind === 'shoot' && hasAbility(state, foe, 'aod.a.camo-cloak') && hasRef(data.rules, 'saturate')) {
        for (let i = data.rules.length - 1; i >= 0; i--) if (data.rules[i]!.rule === 'saturate') data.rules.splice(i, 1)
        markFired('camoCloak')
      }
      // Resolute: Shock does not affect the operative (T-AOD.16)
      if (data.kind === 'fight' && activeTactics(state, foe).includes(ID.tactic('resolute')) && hasRef(data.rules, 'shock')) {
        for (let i = data.rules.length - 1; i >= 0; i--) if (data.rules[i]!.rule === 'shock') data.rules.splice(i, 1)
        markFired('ctResolute')
      }
      // Tilting Shields: the opponent cannot make crits from results under 6 (blocks Lethal, Rending, Severe)
      if (data.kind === 'fight' && tiltingActive(c, foe)) {
        for (let i = data.rules.length - 1; i >= 0; i--) if (['lethal', 'rending', 'severe'].includes(data.rules[i]!.rule)) data.rules.splice(i, 1)
      }
    }
    return null
  },
  'game.modifyWeaponRules',
)

/** Tilting Shields: once per TP; consumed on the first use inside a step and then active for the rest of the action. */
function tiltingActive(c: HookContext, foe: Operative): boolean {
  const state = c.state!
  if (!state.players[foe.seat].equipment.includes(ID.tilting)) return false
  if (!hasKeyword(state, foe, 'ANGEL OF DEATH')) return false
  const live = state.effects.some((e) => e.source === ID.tilting && e.operativeId === foe.id)
  if (live) {
    markFired('tiltingShields')
    return true
  }
  if (tpUsesOf(state, foe.seat, ID.tilting) >= 1) return false
  if (!c.engine) return true // queries see the effect, the step consumes it
  addTpUse(state, foe.seat, ID.tilting)
  addEffect(c.engine, { source: ID.tilting, seat: foe.seat, kind: 'equipment', operativeId: foe.id, expires: 'action' })
  markFired('tiltingShields')
  return true
}

// ---------------------------------------------------------------------------
// modifyStat move (M9 batch B shared fix): the declarative Move change, read by state.effectiveMove through the
// provider moveDelta (the injured -2" and its 4" floor still apply there). `filter` is a weapon filter and does not
// apply to Move; `when` is checked with the operative as the subject.
// ---------------------------------------------------------------------------

/** Net Move change in inches from declarative `modifyStat { stat: 'move' }` effects on the operative. */
export function declarativeMoveDelta(state: GameState, op: Operative): number {
  let d = 0
  for (const s of sourcesFor(state, op)) {
    const m = s.effect.modifyStat
    if (!m || m.stat !== 'move') continue
    if (s.when && !evalCondition(s.when, { state, seat: s.owner, subjectId: op.id, actorId: op.id, action: 'move' })) continue
    d += m.value
  }
  return d
}

registerTeamRules({ id: 'core.modifyStat', moveDelta: declarativeMoveDelta })

// ---------------------------------------------------------------------------
// modifyAttackDice
// ---------------------------------------------------------------------------

registerHook(
  'modifyAttackDice',
  (c) => {
    const op = opOf(c)
    const state = c.state
    if (!op || !state || !c.weaponId) return null
    const data = c.data as {
      kind: 'shoot' | 'fight'
      atk: number
      hitDelta: number
      lethal: number | null
      rerolls: RerollGrant[]
      assists: string[]
    }
    for (const s of sourcesFor(state, op)) {
      const m = s.effect.modifyStat
      if (m && weaponMatches(state, c.weaponId, m.filter) && whenOk(state, s, op, c.weaponId, data.kind, c.targetId)) {
        if (m.stat === 'hit') {
          data.hitDelta += m.value
          if (s.id === 'aod.a.grenadier') markFired('grenadier')
        } else if (m.stat === 'atk') data.atk += m.value
      }
    }
    // And They Shall Know No Fear (and team equivalents such as Plague Bells): the injured Hit penalty is
    // ignored, weapons included. attackStats already leaves the +1 out (hasInjuredPenalty), so ignoring the
    // penalty only removes it; it never improves Hit past the printed value (core rules: injured worsens Hit by 1).
    if (op.flags.ignoreInjured && isInjured(op)) markFired('ignoreInjuredChanges')
    // Ammo Cache: one attack die may be re-rolled when shooting with a datacard weapon (M-5.3)
    if (data.kind === 'shoot' && state.effects.some((e) => e.source === ID.ammo && e.operativeId === op.id)) {
      const card = state.data.datacards[op.datacardId]
      const wid = c.weaponId
      const own = card?.fixedWeapons.includes(wid) || card?.legalLoadouts?.some((l) => l.includes(wid))
      if (own && !data.rerolls.some((r) => r.id === 'ammo-cache')) {
        data.rerolls.push({ id: 'ammo-cache', source: ID.ammo, mode: 'one', used: false })
        markFired('ammoResupply')
      }
    }
    // Siege Specialist: enemies cannot assist against the operative when it fights or retaliates
    if (data.kind === 'fight' && c.targetId) {
      const foe = state.operatives[c.targetId]
      if (foe && activeTactics(state, foe).includes(ID.tactic('siege-specialist')) && data.assists.length > 0) {
        data.assists = []
        markFired('ctSiegeNoAssist')
      }
    }
    return null
  },
  'game.modifyAttackDice',
)

// ---------------------------------------------------------------------------
// modifyDefenceDice
// ---------------------------------------------------------------------------

registerHook(
  'modifyDefenceDice',
  (c) => {
    const op = opOf(c)
    const state = c.state
    if (!op || !state || !c.targetId) return null
    const data = c.data as { saveDelta: number }
    const shooter = state.operatives[c.targetId]
    if (!shooter) return null
    // Portable Barricade: Protective, +1 Save while in cover from it (M-5.10). RULING: any protective part in cover counts.
    const v = targetVerdict(state, bodyOf(shooter), { ...bodyOf(op), order: op.order })
    if (v.inCover) {
      const protective = state.map.features.some((f) => f.parts.some((p) => v.coverParts.includes(p.id) && p.tags?.includes('protective')))
      if (protective) {
        data.saveDelta -= 1
        markFired('portableBarricade')
      }
    }
    return null
  },
  'game.modifyDefenceDice',
)

// ---------------------------------------------------------------------------
// afterAttackRoll (Purity Seals)
// ---------------------------------------------------------------------------

interface DieLike {
  value: number | null
  kind: 'fail' | 'normal' | 'crit'
  rerolled: boolean
  tag?: string
  used?: boolean
}

function fails(dice: DieLike[]): DieLike[] {
  // a tagged failure was set by a rule (an obscured discard, a team rule's locked fail) and is left alone
  return dice.filter((d) => d.kind === 'fail' && d.value !== null && !d.used && !d.tag)
}

registerHook(
  'afterAttackRoll',
  (c) => {
    const op = opOf(c)
    const state = c.state
    if (!op || !state) return null
    const data = c.data as { dice: DieLike[] }
    if (
      state.players[op.seat].equipment.includes(ID.purity) &&
      hasKeyword(state, op, 'ANGEL OF DEATH') &&
      tpUsesOf(state, op.seat, ID.purity) < 1
    ) {
      const f = fails(data.dice)
      if (f.length >= 2 && c.engine) {
        // discard one failure, retain another as a normal success
        f[0]!.value = null
        f[0]!.kind = 'normal'
        f[0]!.tag = 'purity'
        f[1]!.used = true
        addTpUse(state, op.seat, ID.purity)
        c.engine.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.purity }, op.seat)
      }
    }
    return null
  },
  'game.afterAttackRoll',
)

// ---------------------------------------------------------------------------
// afterDefenceRoll: Hardy, Stealthy, Indomitus, Skulk About
// ---------------------------------------------------------------------------

/**
 * M10 batch D shared: the operative is the target of the current Shoot and its player took the Vantage improved cover
 * save (R-11.5b: two cover saves, or one as a crit). Every Stealthy-style improvement (Chapter Tactic, Camo Cloaks,
 * provider `stealthyCover` / `extraCoverSaves`) is not cumulative with it; a player who retained a single cover save
 * did not take the improvement, so those rules still apply.
 */
export function vantageImprovementTaken(state: GameState, op: Operative): boolean {
  const seq = state.attack?.kind === 'shoot' ? state.attack.seq : null
  return !!seq && seq.targetId === op.id && !!seq.improvedCover && (seq.coverMode === 'retainTwo' || seq.coverMode === 'retainCrit')
}

/** Number of Stealthy sources: the team tactic and Camo Cloak count separately (T-AOD.13). */
export function stealthyLevel(state: GameState, op: Operative): number {
  const cfg = state.config[op.seat]
  const team = [cfg.choices['primary-tactic'], cfg.adaptive ?? cfg.choices['secondary-tactic'], ...(op.extraTactics ?? [])]
  const fromTeam = team.includes(ID.tactic('stealthy')) ? 1 : 0
  const camo = hasAbility(state, op, 'aod.a.camo-cloak') ? 1 : 0
  // M9 prep: other teams' Stealthy-style rules (Wyrmblade Cult Agent) through team-rules.ts
  return fromTeam + camo + providerStealthy(state, op)
}

registerHook(
  'afterDefenceRoll',
  (c) => {
    const op = opOf(c)
    const state = c.state
    if (!op || !state) return null
    const data = c.data as { kind: 'shoot' | 'fight'; dice: DieLike[] }
    if (data.kind !== 'shoot') return null
    const dice = data.dice
    // Hardy: defence results of 5+ are crits (T-AOD.16)
    if (activeTactics(state, op).includes(ID.tactic('hardy'))) {
      let any = false
      for (const d of dice) {
        if (d.kind === 'normal' && d.value !== null && d.value >= 5 && !d.used) {
          d.kind = 'crit'
          any = true
        }
      }
      if (any) markFired('ctHardy')
    }
    // Stealthy: when a cover save was retained, retain one more, or retain one cover save as a crit (T-AOD.16).
    // M10 batch D shared: nothing once the Vantage improvement was taken (T-AOD.16 #4, T-AOD.13)
    const vantage = vantageImprovementTaken(state, op)
    const level = vantage ? 0 : stealthyLevel(state, op)
    const cover = dice.filter((d) => d.tag === 'cover')
    if (level > 0 && cover.length > 0) {
      const extra = (): boolean => {
        const f = fails(dice)[0]
        if (!f) return false
        f.value = null
        f.kind = 'normal'
        f.tag = 'cover'
        return true
      }
      const crit = (): boolean => {
        const n = dice.find((d) => d.tag === 'cover' && d.kind === 'normal')
        if (!n) return false
        n.kind = 'crit'
        return true
      }
      let used = false
      if (level >= 2) {
        // Camo Cloak with Stealthy: both options at once
        used = extra() || used
        used = crit() || used
      } else {
        // one option: a spare failure becomes an extra cover save, otherwise upgrade one cover save to a crit
        used = extra() || crit()
      }
      if (used) markFired('ctStealthy')
    }
    // batch D prep (extraCoverSaves): retain more cover saves, never as crits (Camo Cloak, extra-only versions)
    const moreCover = vantage ? 0 : providerExtraCoverSaves(state, op)
    if (moreCover > 0 && dice.some((d) => d.tag === 'cover')) {
      for (let i = 0; i < moreCover; i++) {
        const f = fails(dice)[0]
        if (!f) break
        f.value = null
        f.kind = 'normal'
        f.tag = 'cover'
      }
    }
    // Indomitus: with two or more failures discard one and retain another as a normal success
    if (hasKeyword(state, op, 'ANGEL OF DEATH') && state.effects.some((e) => e.source === ID.indomitus && e.seat === op.seat)) {
      const f = fails(dice)
      if (f.length >= 2) {
        f[0]!.value = null
        f[0]!.kind = 'normal'
        f[0]!.tag = 'indomitus'
        f[1]!.used = true
        c.engine?.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.indomitus }, op.seat)
      }
    }
    // Skulk About: a Conceal Kommando keeps one defence die as a normal success without rolling it
    if (op.order === 'conceal' && hasKeyword(state, op, 'KOMMANDO') && state.effects.some((e) => e.source === ID.skulk && e.seat === op.seat)) {
      const f = fails(dice)[0]
      if (f) {
        f.value = null
        f.kind = 'normal'
        f.tag = 'skulk'
        c.engine?.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.skulk }, op.seat)
      }
    }
    return null
  },
  'game.afterDefenceRoll',
)

// ---------------------------------------------------------------------------
// onDamageInflicted: Iron Halo, Just a Scratch
// ---------------------------------------------------------------------------

const NORMAL_SOURCES = new Set(['normal', 'strike-normal'])

registerHook(
  'onDamageInflicted',
  (c) => {
    const op = opOf(c)
    const state = c.state
    if (!op || !state) return null
    const data = c.data as { source: string; amount: number }
    if (!NORMAL_SOURCES.has(data.source) || data.amount <= 0) return null
    // Iron Halo: once per battle ignore the damage of one normal attack die (T-AOD.8)
    if (hasAbility(state, op, ID.ironHalo) && !op.oncePerBattleUsed.includes(ID.ironHalo)) {
      op.oncePerBattleUsed.push(ID.ironHalo)
      data.amount = 0
      markFired('ironHalo')
      c.engine?.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.ironHalo }, op.seat)
      return null
    }
    // Just a Scratch: ignore one normal-damage die on a friendly Kommando (T-KOM ploy)
    const i = state.effects.findIndex((e) => e.source === ID.scratch && e.operativeId === op.id)
    if (i >= 0) {
      data.amount = 0
      const fx = state.effects[i]!
      state.effects.splice(i, 1)
      c.engine?.emit({ type: 'EffectEnded', effectId: fx.id, source: fx.source }, fx.seat)
      c.engine?.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: ID.scratch }, op.seat)
    }
    return null
  },
  'game.onDamageInflicted',
)

// ---------------------------------------------------------------------------
// beforeStrike: Kunnin' But Brutal, Shock Assault
// ---------------------------------------------------------------------------

registerHook(
  'beforeStrike',
  (c) => {
    const op = opOf(c)
    const state = c.state
    if (!op || !state || !c.engine) return null
    const data = c.data as { die: 'normal' | 'crit' | 'fail'; amount: number }
    const w = c.weaponId ? state.data.weapons[c.weaponId] : undefined
    // Kunnin' but Brutal: the first normal strike counts as a crit
    const k = state.effects.findIndex((e) => e.kind === 'ployFlag' && e.source === ID.kunnin && e.operativeId === op.id && !e.data?.spent)
    if (k >= 0 && data.die === 'normal' && w) {
      data.die = 'crit'
      data.amount = w.dmg.crit
      state.effects[k]!.data = { ...state.effects[k]!.data, spent: true }
      markFired('kunninButBrutal')
    }
    // Shock Assault: the first strike deals 1 extra damage, capped at 7 per die
    const sIdx = state.effects.findIndex((e) => e.kind === 'ployFlag' && e.source === ID.shockAssault && e.operativeId === op.id && !e.data?.spent)
    if (sIdx >= 0) {
      const p = state.effects[sIdx]!.data ?? {}
      const cap = (p.damageCap as number | undefined) ?? 7
      data.amount = Math.min(cap, data.amount + ((p.extraDamage as number | undefined) ?? 1))
      state.effects[sIdx]!.data = { ...p, spent: true }
      markFired('shockAssaultStrike')
    }
    return null
  },
  'game.beforeStrike',
)

// ---------------------------------------------------------------------------
// onFightResolved: declarative damage after a fight (Dat All You Got?)
// ---------------------------------------------------------------------------

registerHook(
  'onFightResolved',
  (c) => {
    const state = c.state
    const engine = c.engine
    if (!state || !engine) return null
    const d = c.data as { attackerId: string; defenderId: string; attackerIncapacitated: boolean; defenderIncapacitated: boolean }
    const sides: [string, string, boolean][] = [
      [d.attackerId, d.defenderId, d.attackerIncapacitated],
      [d.defenderId, d.attackerId, d.defenderIncapacitated],
    ]
    for (const [id, foeId, gone] of sides) {
      const op = state.operatives[id]
      const foe = state.operatives[foeId]
      if (!op || !foe || foe.wounds <= 0) continue
      for (const aid of state.data.datacards[op.datacardId]?.abilities ?? []) {
        const def = state.data.abilities[aid]
        const windows = def?.window === undefined ? [] : Array.isArray(def.window) ? def.window : [def.window]
        if (!def || !windows.includes('fight.resolved')) continue
        for (const eff of effectList(def.effect)) {
          if (!eff.damage) continue
          if (def.when?.survived && gone) continue
          const [r] = engine.roll(`${def.id}.d3`, 1)
          const amount = eff.damage.dice === 'D3' ? Math.ceil(r! / 2) : (eff.damage.amount ?? 0)
          inflict(engine, { targetId: foeId, attackerId: id, weaponId: null, amount, source: 'direct' })
          engine.emit({ type: 'AbilityUsed', operativeId: id, abilityId: def.id, detail: foeId }, op.seat)
        }
      }
    }
    return null
  },
  'game.onFightResolved',
)

// ---------------------------------------------------------------------------
// beforeShootTargetSelect: Sneaky Zogger, point-blank, Explosive
// ---------------------------------------------------------------------------

registerHook(
  'beforeShootTargetSelect',
  (c) => {
    const op = opOf(c)
    const state = c.state
    if (!op || !state) return null
    const data = c.data as { weaponId: string; candidates: string[]; secondary: boolean }
    const w = state.data.weapons[data.weaponId]
    // Explosive: the Squig is its own primary target and may shoot in an enemy control range
    if (w?.rules.some((r) => r.rule === 'explosive')) {
      if (!data.secondary) data.candidates.splice(0, data.candidates.length, op.id)
      markFired('explosiveRule')
      return null
    }
    // Point-blank (R-4.11): only enemies in the shooter's own control range, even if not otherwise valid
    if (state.attack?.pointBlank && state.attack.operativeId === op.id && !data.secondary) {
      data.candidates.splice(0, data.candidates.length, ...enemiesInControlRange(state, op, op.seat).filter((e) => e.wounds > 0).map((e) => e.id))
    }
    // Sneaky Zogger: a Grot in cover cannot be selected, beating Seek and Vantage, except within 2" (T-KOM.16)
    if (!data.secondary) {
      for (let i = data.candidates.length - 1; i >= 0; i--) {
        const t = state.operatives[data.candidates[i]!]
        if (!t || !hasAbility(state, t, 'kom.a.sneaky-zogger')) continue
        const v = targetVerdict(state, bodyOf(op), { ...bodyOf(t), order: t.order })
        if (v.inCover && !v.within2) {
          data.candidates.splice(i, 1)
          markFired('sneakyZogger')
        }
      }
    }
    return null
  },
  'game.beforeShootTargetSelect',
)

// ---------------------------------------------------------------------------
// afterShootResolved: first Shoot of the battle, Concealed Position
// ---------------------------------------------------------------------------

registerHook(
  'afterShootResolved',
  (c) => {
    const op = opOf(c)
    const state = c.state
    if (!op || !state) return null
    if (!op.oncePerBattleUsed.includes('shot')) op.oncePerBattleUsed.push('shot')
    // Concealed Position: the profile can only be used the first time the operative ever Shoots (T-KOM weapon text)
    const id = 'kom.w.scoped-big-shoota-concealed'
    if (op.weapons.includes(id)) {
      op.weapons = op.weapons.filter((w) => w !== id)
      markFired('concealedPosition')
    }
    return null
  },
  'game.afterShootResolved',
)

// ---------------------------------------------------------------------------
// target.status: OPTICS, Auspex and Smoke change whether a target is obscured
// ---------------------------------------------------------------------------

registerHook(
  'target.status',
  (c) => {
    const shooter = opOf(c)
    const state = c.state
    const target = state && c.targetId ? state.operatives[c.targetId] : undefined
    if (!shooter || !state || !target) return null
    const data = c.data as unknown as TargetStatusData
    if (data.obscured) {
      // OPTICS: enemies the operative shoots cannot be obscured (T-AOD.14)
      if (state.effects.some((e) => e.source === 'aod.a.optics' && e.operativeId === shooter.id)) {
        data.obscured = false
        markFired('optics')
      }
      // Auspex: enemies within 8" of the shooter cannot be obscured until the end of the activation
      const aus = state.effects.find((e) => e.source === 'aod.e.auspex' && e.operativeId === shooter.id)
      if (data.obscured && aus && distanceBetween(bodyOf(shooter), bodyOf(target)) <= ((aus.data?.radius as number | undefined) ?? 8) + 1e-6) {
        data.obscured = false
        markFired('auspex')
      }
    } else if (smokeObscures(state, shooter, target)) {
      data.obscured = true
    }
    return null
  },
  'game.target.status',
)

export { markUsedBattle, usedThisBattle }
