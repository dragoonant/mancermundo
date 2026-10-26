// Kommandos (docs/spec/13-teams.md section 2): the code hooks their data names. Passive rules register
// their name and fire where the engine consults them; actions, ploys and Boom! live here.
import { applyAplEffect, attackStats, blastSecondaries, blockPlans, countKinds, defenceStats, inflict, newSide, pushRolled, retainAttack, ruleSetFor } from '../attack-common'
import { bodyOf, visible } from '../los'
import { distanceBetween, enemiesInControlRange } from '../measure'
import { markFired, registerCodeHook, type OfferSeed, type PloyOfferSeed } from '../code-hooks'
import { codeParams, hasKeyword } from '../conditions'
import { commsBonus } from '../core-hooks'
import { addEffect, queueRemoval } from '../effects'
import { cancelAction, finishAction, startFreeAction } from '../firefight'
import { dist2, distPointSegment, round3 } from '../geometry'
import { registerFrameResume, registerHook } from '../hooks'
import { newMarkerId } from '../markers'
import type { Ctx } from '../registry'
import { friendsOf } from '../state'
import { placementProblem, terrainOf } from '../terrain'
import type { GameState, Marker, Operative, Vec2 } from '../types'
import { refreshFlags } from '../abilities'

for (const name of ['throatSlittas', 'krumpinTime', 'stoopid', 'sneakyZogger', 'explosiveRule', 'concealedPosition', 'choppasEquipment']) {
  registerCodeHook({ name })
}

// ---------------------------------------------------------------------------
// GET IT DUN! and LISTEN IN (SUPPORT): +1 APL to a visible friendly Kommando
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'supportAplBoost',
  action: {
    offers(state, op, def): OfferSeed[] {
      const p = codeParams(state, op, 'supportAplBoost') ?? {}
      // the Comms Device grows the range by 3" while a friendly operative controls it (M-5.1)
      const range = ((p.range as number | undefined) ?? 6) + (p.comms !== false ? commsBonus(state, op.seat) : 0)
      const exclude = (p.excludeKeywords as string[] | undefined) ?? []
      const out: OfferSeed[] = []
      for (const f of friendsOf(state, op)) {
        if (f.wounds <= 0 || !hasKeyword(state, f, 'KOMMANDO') || exclude.some((k) => hasKeyword(state, f, k))) continue
        if (distanceBetween(bodyOf(op), bodyOf(f)) > range + 1e-6) continue
        if (!visible(state, bodyOf(op), bodyOf(f)) && !visible(state, bodyOf(f), bodyOf(op))) continue
        out.push({ key: f.id, params: { targetId: f.id } })
      }
      void def
      return out
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!target || target.status !== 'active') {
        cancelAction(ctx)
        return
      }
      const delta = ((codeParams(ctx.state, op, 'supportAplBoost') ?? {}).aplDelta as number | undefined) ?? 1
      applyAplEffect(ctx, target.id, delta, def.id)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// BREACH (T-KOM.12)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'breach',
  action: {
    offers(state, op): OfferSeed[] {
      const idx = terrainOf(state.map)
      const seen = new Set<string>()
      const out: OfferSeed[] = []
      for (const s of idx.solids) {
        if (seen.has(s.featureId)) continue
        const gap = polygonGap(op.pos, op.baseRadius, s.polygon)
        if (gap > 1 + 1e-6) continue
        seen.add(s.featureId)
        out.push({ key: s.featureId, params: { featureId: s.featureId } })
      }
      return out
    },
    perform(ctx, op, def, params) {
      const s = ctx.state
      const idx = terrainOf(s.map)
      // as close as possible to the feature: the nearest point of any of its parts, kept within the control range
      let best: { p: Vec2; gap: number } | null = null
      for (const sol of idx.solids) {
        if (sol.featureId !== params.featureId) continue
        const near = nearestPoint(op.pos, sol.polygon)
        const gap = dist2(near, op.pos) - op.baseRadius
        if (!best || gap < best.gap) best = { p: near, gap }
      }
      if (!best) {
        cancelAction(ctx)
        return
      }
      const reach = Math.min(best.gap, 1)
      const dir = unit(op.pos, best.p)
      const pos = { x: round3(op.pos.x + dir.x * (op.baseRadius + reach)), z: round3(op.pos.z + dir.z * (op.baseRadius + reach)) }
      // one Breach marker per Breacha Boy: placing again replaces it (RULING)
      s.markers = s.markers.filter((m) => !(m.equipmentId === 'breach' && m.placedBy === op.id))
      const marker: Marker = {
        id: newMarkerId(ctx, 'breach'),
        kind: 'equipment',
        pos,
        owner: op.seat,
        carriedBy: null,
        controller: null,
        equipmentId: 'breach',
        placedBy: op.id,
        featureId: params.featureId as string,
      }
      s.markers.push(marker)
      ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos }, op.seat)
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: params.featureId as string }, op.seat)
      finishAction(ctx)
    },
  },
})

function nearestPoint(p: Vec2, poly: Vec2[]): Vec2 {
  let best = poly[0]!
  let bd = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l2 = dx * dx + dz * dz
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2))
    const q = { x: a.x + dx * t, z: a.z + dz * t }
    const d = dist2(p, q)
    if (d < bd) {
      bd = d
      best = q
    }
  }
  return best
}

function polygonGap(pos: Vec2, r: number, poly: Vec2[]): number {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.z > pos.z !== b.z > pos.z && pos.x < ((b.x - a.x) * (pos.z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  if (inside) return 0
  let d = Infinity
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distPointSegment(pos, poly[i]!, poly[(i + 1) % poly.length]!))
  return Math.max(0, d - r)
}

function unit(a: Vec2, b: Vec2): Vec2 {
  const d = dist2(a, b) || 1
  return { x: (b.x - a.x) / d, z: (b.z - a.z) / d }
}

// ---------------------------------------------------------------------------
// DAKKA DASH (T-KOM.13): a free Dash and a free Shoot with a dakka shoota, in either order
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'dakkaDash',
  action: {
    offers(state, op): OfferSeed[] {
      if (op.order !== 'engage') return []
      if (!op.weapons.some((w) => (state.data.weapons[w]?.name ?? '').toLowerCase().includes('dakka shoota'))) return []
      return [{ key: '', params: {} }]
    },
    perform(ctx, op, def) {
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'dakkaDash', operativeId: op.id, abilityId: def.id },
        options: [
          { id: 'dash-first', labelKey: 'dakka.dashFirst', type: 'ability.choice', payload: { option: 'dash-first' } },
          { id: 'shoot-first', labelKey: 'dakka.shootFirst', type: 'ability.choice', payload: { option: 'shoot-first' } },
        ],
        canPass: true,
      })
    },
  },
  choice(ctx, op, option) {
    const order: ('dash' | 'shoot')[] = option === 'shoot-first' ? ['shoot', 'dash'] : ['dash', 'shoot']
    runDakka(ctx, op.id, order)
  },
})

function runDakka(ctx: Ctx, opId: string, order: ('dash' | 'shoot')[]): void {
  const [first, ...rest] = order
  if (!first) {
    // both free actions are done: they count as performed for the activation (R-3.9), the AP was paid on declaration
    const act = ctx.state.firefight.activation!
    for (const a of ['dash', 'shoot']) if (!act.performed.includes(a)) act.performed.push(a)
    finishAction(ctx)
    return
  }
  const started = startFreeAction(ctx, {
    operativeId: opId,
    action: first,
    resume: 'dakkaDash',
    data: { rest, opId },
    ...(first === 'shoot' ? { weaponNameContains: 'dakka shoota' } : {}),
  })
  if (!started) runDakka(ctx, opId, rest)
}

registerFrameResume('dakkaDash', (ctx, _outcome, data) => {
  runDakka(ctx, data.opId as string, (data.rest as ('dash' | 'shoot')[]) ?? [])
})

// ---------------------------------------------------------------------------
// GRAPPLING HOOK (T-KOM.17)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'grapplingHook',
  action: {
    offers(state, op): OfferSeed[] {
      const idx = terrainOf(state.map)
      const near = idx.solids.some((s) => polygonGap(op.pos, op.baseRadius, s.polygon) <= 8)
      return near ? [{ key: '', params: {} }] : []
    },
    perform(ctx, op, def) {
      const spots = grappleSpots(ctx.state, op)
      if (spots.length === 0) {
        cancelAction(ctx)
        return
      }
      const act = ctx.state.firefight.activation!
      act.declared = { ...act.declared!, params: { ...(act.declared!.params ?? {}), treatedAs: 'reposition' } }
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'grapplingHook', operativeId: op.id, abilityId: def.id },
        options: spots.map((s) => ({ id: `${s.x},${s.y},${s.z}`, labelKey: 'grapple.land', type: 'ability.choice' as const, payload: { option: `${s.x},${s.y},${s.z}` }, data: s })),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const [x, y, z] = option.split(',').map(Number) as [number, number, number]
    const from = { ...op.pos }
    op.pos = { x, y, z }
    op.facing = Math.atan2(x - from.x, z - from.z)
    const length = Math.hypot(x - from.x, z - from.z)
    ctx.emit({
      type: 'OperativeMoved',
      operativeId: op.id,
      action: 'grapplingHook',
      from,
      to: op.pos,
      segments: [{ from, to: op.pos, length: round3(length), cost: 0, kind: 'jump' }],
      cost: 0,
      maxInches: 0,
    })
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: context.abilityId as string }, op.seat)
    finishAction(ctx)
  },
})

/** Landing spots within 1" of a visible point on a terrain feature (T-KOM.17); at most 16, farthest first. */
export function grappleSpots(state: GameState, op: Operative): { x: number; y: number; z: number }[] {
  const idx = terrainOf(state.map)
  const counter = state.firefight.activation?.counteract === true
  const out: { x: number; y: number; z: number; d: number }[] = []
  const seen = new Set<string>()
  const probe = (p: Vec2, y: number) => ({ id: 'grapple-probe', pos: { x: p.x, y: y - 0.05, z: p.z }, baseRadius: 0.05, height: 0.05 })
  for (const s of idx.solids) {
    if (s.top < 1) continue
    const c = { x: (s.bbox.minX + s.bbox.maxX) / 2, z: (s.bbox.minZ + s.bbox.maxZ) / 2 }
    // points on the feature: its corners and the middle of every edge, at the height of its top
    const pts: Vec2[] = []
    for (let i = 0; i < s.polygon.length; i++) {
      const p = s.polygon[i]!
      const q = s.polygon[(i + 1) % s.polygon.length]!
      pts.push(p, { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 })
    }
    for (const v of pts) {
      if (!visible(state, bodyOf(op), probe(v, s.top), { operativesBlock: false })) continue
      // candidate landing spots: on the surface behind the point, and on the floor beside it
      const inward = unit(v, c)
      const cands: { x: number; y: number; z: number }[] = []
      for (const f of s.floors) {
        for (const k2 of [op.baseRadius + 0.05, op.baseRadius * 1.5 + 0.05, op.baseRadius * 1.5 + 0.4]) {
          cands.push({ x: v.x + inward.x * k2, y: f, z: v.z + inward.z * k2 })
        }
      }
      for (let a2 = 0; a2 < 6; a2++) {
        const ang = (a2 / 6) * Math.PI * 2
        cands.push({ x: v.x + Math.sin(ang) * 0.9, y: 0, z: v.z + Math.cos(ang) * 0.9 })
      }
      for (const cand of cands) {
        const pos = { x: round3(cand.x), y: cand.y, z: round3(cand.z) }
        const key = `${pos.x},${pos.y},${pos.z}`
        if (seen.has(key)) continue
        seen.add(key)
        if (dist2(pos, v) > 1 + 1e-6) continue
        if (placementProblem(state, { id: op.id, pos, radius: op.baseRadius, height: op.height })) continue
        const moved = { ...op, pos }
        if (enemiesInControlRange(state, moved, op.seat).length > 0) continue
        const gap = Math.max(0, dist2(pos, op.pos) - 2 * op.baseRadius)
        if (counter && gap > 2 + 1e-6) continue
        if (!visible(state, bodyOf(moved), probe(v, s.top), { operativesBlock: false })) continue
        out.push({ ...pos, d: gap })
      }
    }
  }
  out.sort((a, b) => b.d - a.d || a.x - b.x || a.z - b.z)
  return out.slice(0, 16).map(({ x, y, z }) => ({ x, y, z }))
}

// ---------------------------------------------------------------------------
// Ploys
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'kunninButBrutal',
  ploy: {
    offers(): PloyOfferSeed[] {
      return [{}]
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (info.subjectId) addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'action' })
    },
  },
})

registerCodeHook({
  name: 'shakeItOff',
  ploy: {
    offers(state, seat, _ploy, info): PloyOfferSeed[] {
      const op = info.subjectId ? state.operatives[info.subjectId] : undefined
      if (!op || op.seat !== seat || op.flags.ignoreApl) return []
      return [{}]
    },
    apply(ctx, seat, ploy, _seed, info) {
      if (!info.subjectId) return
      addEffect(ctx, { source: ploy.id, seat, kind: 'ployFlag', operativeId: info.subjectId, expires: 'turningPointStart' })
      refreshFlags(ctx.state)
    },
  },
})

// ---------------------------------------------------------------------------
// Boom! (T-KOM.8): the Bomb Squig's last explosion
// ---------------------------------------------------------------------------

registerCodeHook({ name: 'boom' })

/**
 * An incapacitated Bomb Squig that never used its explosives rolls two D6 (RULING: the AI always rolls
 * two); on any 4+ it makes a free Shoot with its Explosives before removal. Resolved automatically: the
 * Squig is its own primary target (no cover, no obscured), Blast 1" then hits every operative visible
 * within 1", friend or foe.
 */
export function boom(ctx: Ctx, squigId: string): boolean {
  const s = ctx.state
  const squig = s.operatives[squigId]
  if (!squig || !s.data.datacards[squig.datacardId]?.abilities.includes('kom.a.boom')) return false
  const params = codeParams(s, squig, 'boom') ?? {}
  const weaponId = (params.weapon as string | undefined) ?? 'kom.w.explosives'
  if ((squig.usedLimited[weaponId] ?? 0) > 0 || squig.oncePerBattleUsed.includes('boom')) return false
  squig.oncePerBattleUsed.push('boom')
  const dice = ctx.roll('boom', (params.dice as number | undefined) ?? 2)
  const need = (params.successOn as number | undefined) ?? 4
  if (!dice.some((d) => d >= need)) return false
  markFired('boom')
  ctx.emit({ type: 'AbilityUsed', operativeId: squig.id, abilityId: 'kom.a.boom' }, squig.seat)
  squig.usedLimited[weaponId] = 1
  const rules = ruleSetFor(s, squig, weaponId, 'shoot', squig.id, ctx)
  // the Squig is the primary target; its Blast 1" hits every other operative visible to it within 1"
  const victims = blastSecondaries(s, squig, squig, rules.blast ?? 1)
  for (const id of victims) {
    const victim = s.operatives[id]
    if (!victim || victim.status !== 'active') continue
    const stats = attackStats(s, squig.id, weaponId, victim.id, { kind: 'shoot' }, ctx)
    const atk = newSide(squig.seat, squig.id, weaponId, stats.need, stats.lethal, [])
    pushRolled(atk, ctx.roll('boom.attack', stats.atk))
    retainAttack(atk, rules, false)
    const a = countKinds(atk.dice)
    const ds = defenceStats(s, victim.id, squig.id, weaponId, rules, a.crit > 0, ctx)
    const def = newSide(victim.seat, victim.id, null, ds.need, null, [])
    pushRolled(def, ctx.roll('boom.defence', ds.collected))
    const d = countKinds(def.dice)
    const weapon = s.data.weapons[weaponId]!
    const plan = blockPlans(a.normal, a.crit, d.normal, d.crit, weapon.dmg, rules.brutal)[0]!
    for (let i = 0; i < plan.unblockedCrit; i++) inflict(ctx, { targetId: victim.id, attackerId: squig.id, weaponId, amount: weapon.dmg.crit, source: 'crit' })
    for (let i = 0; i < plan.unblockedNormal; i++) inflict(ctx, { targetId: victim.id, attackerId: squig.id, weaponId, amount: weapon.dmg.normal, source: 'normal' })
    queueRemoval(ctx, victim.id)
  }
  return true
}

// The Squig explodes in the "before removal" window of its incapacitation (R-7.2, R-5.18).
registerHook(
  'operative.incapacitated',
  (c) => {
    if (c.engine && c.operativeId) boom(c.engine, c.operativeId)
    return null
  },
  'game.boom',
)
