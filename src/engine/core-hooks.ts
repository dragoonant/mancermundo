// Code hooks for the universal rules: mission actions, equipment actions and markers (Comms Device,
// Mines, Ammo Cache, Razor Wire, Ladders, Portable Barricade, grenades). Names match src/data/code-hooks.json.
import { registerCodeHook, markFired, type OfferSeed } from './code-hooks'
import { codeParams, evalCondition } from './conditions'
import { addEffect, addUse, markUsedTp, usedThisTp, usesOf } from './effects'
import { cancelAction, finishAction } from './firefight'
import { placementIssue } from './equipment'
import { applyAplEffect } from './attack-common'
import { bodyOf, visible } from './los'
import { distanceBetween } from './measure'
import { dist2, round3 } from './geometry'
import { controlledBy, newMarkerId } from './markers'
import { markLooted, markSecured, markTransmitting } from './missions'
import { moveConstraints } from './movement'
import type { Ctx } from './registry'
import { enemiesOf, getOp } from './state'
import type { GameState, Marker, MapDef, Operative, Seat, TerrainFeatureDef, Vec2 } from './types'

const OBJECTIVE_ACTION = (
  name: string,
  filter: (state: GameState, marker: Marker, op: Operative) => boolean,
  apply: (ctx: Ctx, op: Operative, marker: Marker) => void,
) => {
  registerCodeHook({
    name,
    action: {
      offers(state, op): OfferSeed[] {
        return controlledBy(state, op, (m) => m.kind === 'objective' && filter(state, m, op)).map((m) => ({ key: m.id, params: { markerId: m.id } }))
      },
      perform(ctx, op, def, params) {
        const m = ctx.state.markers.find((k) => k.id === params.markerId)
        if (!m) {
          cancelAction(ctx)
          return
        }
        apply(ctx, op, m)
        ctx.emit({ type: 'MissionActionPerformed', operativeId: op.id, action: def.id, markerId: m.id }, op.seat)
        finishAction(ctx)
      },
    },
  })
}

// Secure (M-3.1): stays secured by a team until the enemy secures it.
OBJECTIVE_ACTION(
  'missionSecure',
  (s, m, op) => s.mission?.secured[m.id] !== op.seat,
  (ctx, op, m) => markSecured(ctx, op.seat, m.id),
)
// Loot (M-3.3): not if the marker has already been looted this TP, by either team.
OBJECTIVE_ACTION(
  'missionLoot',
  (s, m) => !(s.mission?.looted ?? []).includes(m.id),
  (ctx, op, m) => markLooted(ctx, op.seat, m.id),
)
// Initiate Transmission (M-3.5)
OBJECTIVE_ACTION(
  'missionTransmit',
  (s, m) => !(s.mission?.transmitting ?? []).includes(m.id),
  (ctx, _op, m) => markTransmitting(ctx, m.id),
)

// ---------------------------------------------------------------------------
// Ammo Cache (M-5.3)
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'ammoResupply',
  action: {
    offers(state, op): OfferSeed[] {
      return controlledBy(state, op, (m) => m.equipmentId === 'core.e.ammo-cache' && m.owner === op.seat && m.usedTp !== state.turningPoint).map((m) => ({
        key: m.id,
        params: { markerId: m.id },
        cost: 0,
      }))
    },
    perform(ctx, op, def, params) {
      const m = ctx.state.markers.find((k) => k.id === params.markerId)
      if (!m) {
        cancelAction(ctx)
        return
      }
      m.usedTp = ctx.state.turningPoint
      addEffect(ctx, { source: 'core.e.ammo-cache', seat: op.seat, kind: 'equipment', operativeId: op.id, expires: 'turningPoint' })
      ctx.emit({ type: 'MissionActionPerformed', operativeId: op.id, action: def.id, markerId: m.id }, op.seat)
      finishAction(ctx)
    },
  },
})

// ---------------------------------------------------------------------------
// Passive markers and terrain: the hook names exist so the data can reference them; they fire where the rule bites.
// ---------------------------------------------------------------------------

registerCodeHook({ name: 'commsDevice' })
registerCodeHook({ name: 'mines' })
registerCodeHook({ name: 'razorWire' })
registerCodeHook({ name: 'ladders' })

/** Comms Device (M-5.1): +3" to SUPPORT distances while a friendly operative controls the team's own marker. */
export function commsBonus(state: GameState, seat: Seat): number {
  const p = state.data.abilities['core.e.comms-device']
  void p
  for (const m of state.markers) {
    if (m.equipmentId !== 'core.e.comms-device' || m.owner !== seat) continue
    for (const op of Object.values(state.operatives)) {
      if (op.seat !== seat || op.status !== 'active') continue
      if (controlledBy(state, op, (k) => k.id === m.id).length > 0) {
        markFired('commsDevice')
        return codeParamsFromEquipment(state, 'core.e.comms-device', 'supportRangeBonus', 3)
      }
    }
  }
  return 0
}

function codeParamsFromEquipment(state: GameState, equipmentId: string, key: string, fallback: number): number {
  const e = state.data.equipment?.[equipmentId]
  const eff = Array.isArray(e?.effect) ? e!.effect[0] : e?.effect
  const v = (eff?.params as Record<string, unknown> | undefined)?.[key]
  return typeof v === 'number' ? v : fallback
}

// ---------------------------------------------------------------------------
// Grenades: stun and smoke (M-5.5), team totals and Taktical Wot-notz
// ---------------------------------------------------------------------------

export type GrenadeSource = 'team' | 'taktical'

/** Which allowance covers a grenade action for this operative now, or null. Taktical Wot-notz is used first. */
export function grenadeSource(state: GameState, op: Operative, abilityId: string): GrenadeSource | null {
  const card = state.data.datacards[op.datacardId]
  if (card?.abilities.includes('kom.a.taktical-wot-notz') && !usedThisTp(state, op.seat, `taktical:${abilityId}`)) return 'taktical'
  const picks = state.equipment.picks[op.seat]?.['core.e.utility-grenades'] ?? []
  const total = picks.filter((p) => p === abilityId).length
  if (usesOf(state, op.seat, abilityId) < total) return 'team'
  return null
}

function spendGrenade(ctx: Ctx, op: Operative, abilityId: string, source: GrenadeSource): void {
  if (source === 'taktical') {
    markUsedTp(ctx.state, op.seat, `taktical:${abilityId}`)
    markFired('taktikalWotNotz')
  } else addUse(ctx.state, op.seat, abilityId)
}

/** Enemies visible to the operative and within `range` (inches, base to base). */
export function visibleEnemiesWithin(state: GameState, op: Operative, range: number): Operative[] {
  return enemiesOf(state, op).filter((e) => e.wounds > 0 && distanceBetween(bodyOf(op), bodyOf(e)) <= range + 1e-6 && visible(state, bodyOf(op), bodyOf(e)))
}

registerCodeHook({
  name: 'stunGrenade',
  action: {
    offers(state, op, def): OfferSeed[] {
      const source = grenadeSource(state, op, def.id)
      if (!source) return []
      const range = (codeParams(state, op, 'stunGrenade')?.range as number | undefined) ?? 6
      return visibleEnemiesWithin(state, op, range).map((e) => ({ key: e.id, params: { targetId: e.id, source }, data: { source } }))
    },
    perform(ctx, op, def, params) {
      const target = ctx.state.operatives[params.targetId as string]
      if (!target || target.status !== 'active') {
        cancelAction(ctx)
        return
      }
      spendGrenade(ctx, op, def.id, params.source as GrenadeSource)
      // the target and every other operative within 1" of it take a stun test
      const tb = bodyOf(target)
      const victims = Object.values(ctx.state.operatives).filter((o) => o.status === 'active' && (o.id === target.id || distanceBetween(tb, bodyOf(o)) <= 1 + 1e-6))
      for (const v of victims) {
        const [r] = ctx.roll('stun.test', 1)
        if (r! >= 3) applyAplEffect(ctx, v.id, -1, 'stun-grenade')
      }
      ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: def.id, detail: target.id }, op.seat)
      finishAction(ctx)
    },
  },
})

function smokeSpots(state: GameState, op: Operative, range: number): Vec2[] {
  const out: Vec2[] = []
  const seen = new Set<string>()
  const add = (p: Vec2) => {
    const q = { x: round3(p.x), z: round3(p.z) }
    const k = `${q.x},${q.z}`
    if (seen.has(k) || Math.abs(q.x) > 15 || Math.abs(q.z) > 11) return
    if (Math.max(0, dist2(q, op.pos) - op.baseRadius) > range + 1e-6) return
    const probe = { id: 'smoke-probe', pos: { x: q.x, y: op.pos.y, z: q.z }, baseRadius: 0.05, height: 0.05 }
    // a marker may lie under an operative, so operatives do not block the line to the spot
    if (!visible(state, bodyOf(op), probe, { operativesBlock: false })) return
    seen.add(k)
    out.push(q)
  }
  for (const e of enemiesOf(state, op)) add({ x: e.pos.x, z: e.pos.z })
  for (const d of [2, 4, 6]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      add({ x: op.pos.x + Math.sin(a) * (d + op.baseRadius), z: op.pos.z + Math.cos(a) * (d + op.baseRadius) })
    }
  }
  return out
}

registerCodeHook({
  name: 'smokeGrenade',
  action: {
    offers(state, op, def): OfferSeed[] {
      const source = grenadeSource(state, op, def.id)
      if (!source) return []
      const range = (codeParams(state, op, 'smokeGrenade')?.range as number | undefined) ?? 6
      return smokeSpots(state, op, range).length > 0 ? [{ key: '', params: { source } }] : []
    },
    perform(ctx, op, def, params) {
      const spots = smokeSpots(ctx.state, op, 6)
      if (spots.length === 0) {
        cancelAction(ctx)
        return
      }
      ctx.raise({
        kind: 'ability.choice',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { hook: 'smokeGrenade', operativeId: op.id, abilityId: def.id, source: params.source },
        options: spots.map((p) => ({ id: `${p.x},${p.z}`, labelKey: 'smoke.place', type: 'ability.choice' as const, payload: { option: `${p.x},${p.z}` }, data: { x: p.x, z: p.z } })),
        canPass: true,
      })
    },
  },
  choice(ctx, op, option, context) {
    const [x, z] = option.split(',').map(Number) as [number, number]
    spendGrenade(ctx, op, context.abilityId as string, context.source as GrenadeSource)
    const marker: Marker = {
      id: newMarkerId(ctx, 'smoke'),
      kind: 'equipment',
      pos: { x, z },
      owner: op.seat,
      carriedBy: null,
      controller: null,
      equipmentId: 'smoke',
      placedBy: op.id,
      clearsAfter: null,
    }
    ctx.state.markers.push(marker)
    ctx.emit({ type: 'MarkerPlaced', markerId: marker.id, operativeId: op.id, pos: { x, z } }, op.seat)
    ctx.emit({ type: 'AbilityUsed', operativeId: op.id, abilityId: context.abilityId as string, detail: `${x},${z}` }, op.seat)
    finishAction(ctx)
  },
})

/** Taktical Wot-notz and the grenade picks make the grenade actions available to Boys even when the team picked none. */
registerCodeHook({ name: 'taktikalWotNotz' })

/** Is the base wholly inside a smoke cloud (1" radius around a Smoke marker)? */
export function whollyInSmoke(state: GameState, pos: Vec2, baseRadius: number): boolean {
  for (const m of state.markers) {
    if (m.equipmentId !== 'smoke') continue
    if (dist2(m.pos, pos) + baseRadius <= 1 + 1e-6) return true
  }
  return false
}

/** Smoke obscures an operative wholly in it to operatives more than 2" away, and vice versa (M-5.5). */
export function smokeObscures(state: GameState, shooter: Operative, target: Operative): boolean {
  if (distanceBetween(bodyOf(shooter), bodyOf(target)) <= 2 + 1e-6) return false
  return whollyInSmoke(state, target.pos, target.baseRadius) || whollyInSmoke(state, shooter.pos, shooter.baseRadius)
}

/** Ready step: smoke placed last turning point starts its countdown (D3 activations of this TP). */
export function smokeReady(ctx: Ctx): void {
  for (const m of ctx.state.markers) {
    if (m.equipmentId === 'smoke' && m.clearsAfter === null) {
      const [d] = ctx.roll('smoke.clear', 1)
      m.clearsAfter = Math.ceil(d! / 2)
    }
  }
}

/** One activation (not a counteraction) completed. */
export function smokeActivation(ctx: Ctx): void {
  for (const m of [...ctx.state.markers]) {
    if (m.equipmentId !== 'smoke' || m.clearsAfter === null || m.clearsAfter === undefined) continue
    m.clearsAfter -= 1
    if (m.clearsAfter <= 0) {
      ctx.state.markers = ctx.state.markers.filter((k) => k.id !== m.id)
      ctx.emit({ type: 'MarkerRemoved', markerId: m.id, reason: 'smoke cleared' }, null)
    }
  }
}

/** End of the turning point: any smoke already counting down is gone. */
export function smokeTurningPointEnd(ctx: Ctx): void {
  for (const m of [...ctx.state.markers]) {
    if (m.equipmentId === 'smoke' && m.clearsAfter !== null && m.clearsAfter !== undefined) {
      ctx.state.markers = ctx.state.markers.filter((k) => k.id !== m.id)
      ctx.emit({ type: 'MarkerRemoved', markerId: m.id, reason: 'smoke cleared' }, null)
    }
  }
}

// ---------------------------------------------------------------------------
// Portable Barricade (M-5.10)
// ---------------------------------------------------------------------------

registerCodeHook({ name: 'portableBarricade' })

function portableFeatures(state: GameState, seat: Seat): TerrainFeatureDef[] {
  return state.map.features.filter((f) => f.equipmentId === 'core.e.portable-barricade' && f.owner === seat)
}

/** A barricade is connected to the operative when its base is within 1" of the barricade. */
function connected(state: GameState, op: Operative, f: TerrainFeatureDef): boolean {
  const poly = f.parts[0]!.footprint
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l2 = dx * dx + dz * dz
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((op.pos.x - a.x) * dx + (op.pos.z - a.z) * dz) / l2))
    best = Math.min(best, Math.hypot(op.pos.x - (a.x + dx * t), op.pos.z - (a.z + dz * t)))
  }
  return best - op.baseRadius <= 1 + 1e-6 && state.operatives[op.id] !== undefined
}

registerCodeHook({
  name: 'moveWithBarricade',
  action: {
    offers(state, op): OfferSeed[] {
      return portableFeatures(state, op.seat)
        .filter((f) => connected(state, op, f))
        .map((f) => ({ key: f.id, params: { featureId: f.id } }))
    },
    perform(ctx, op, _def, params) {
      const act = ctx.state.firefight.activation!
      const maxInches = Math.max(0, op.move - 2)
      act.declared = { ...act.declared!, params: { moveKind: 'reposition', maxInches, afterMove: 'moveWithBarricade', featureId: params.featureId, treatedAs: 'reposition' } }
      const c = moveConstraints(op, 'reposition', act.counteract)
      c.maxInches = Math.min(c.maxInches ?? maxInches, maxInches)
      ctx.raise({
        kind: 'move.path',
        seat: op.seat,
        window: 'firefight.actionDeclared',
        context: { operativeId: op.id, action: 'moveWithBarricade', maxInches: c.maxInches },
        constraints: c,
        canPass: true,
      })
    },
  },
  /** After the move the barricade is set up again connected to the same side (M-5.10); if it cannot be, it is not set up. */
  afterMove(ctx, op, from, params) {
    const f = ctx.state.map.features.find((x) => x.id === params.featureId)
    if (!f) return
    const dx = op.pos.x - from.x
    const dz = op.pos.z - from.z
    const old = f.parts[0]!
    const moved = old.footprint.map((p) => ({ x: round3(p.x + dx), z: round3(p.z + dz) }))
    const centre = { x: round3(moved.reduce((s, p) => s + p.x, 0) / moved.length), z: round3(moved.reduce((s, p) => s + p.z, 0) / moved.length) }
    const key = f.id.slice(3)
    const rest: MapDef = { ...ctx.state.map, features: ctx.state.map.features.filter((x) => x.id !== f.id) }
    const before = ctx.state.map
    ctx.state.map = rest
    const yaw = Math.round((Math.atan2(old.footprint[1]!.z - old.footprint[0]!.z, old.footprint[1]!.x - old.footprint[0]!.x) * 180) / Math.PI)
    const item = { key, equipmentId: 'core.e.portable-barricade', kind: 'terrain' as const }
    if (placementIssueRelaxed(ctx.state, op.seat, item, centre, yaw)) {
      ctx.emit({ type: 'MarkerRemoved', markerId: f.id, reason: 'portable barricade could not be set up' }, op.seat)
      return
    }
    const feature: TerrainFeatureDef = { ...f, parts: [{ ...old, footprint: moved }] }
    ctx.state.map = { ...before, features: before.features.map((x) => (x.id === f.id ? feature : x)) }
  },
})

function placementIssueRelaxed(state: GameState, seat: Seat, item: { key: string; equipmentId: string; kind: 'terrain' }, centre: Vec2, yaw: number): boolean {
  // The portable barricade keeps its place in the territory only at set-up; once moved it needs just the clearances.
  const e = state.data.equipment?.[item.equipmentId]
  if (!e?.setup) return true
  const saved = e.setup
  const relaxed = { ...e, setup: { ...saved, whollyWithinTerritory: false } }
  const patched: GameState = { ...state, data: { ...state.data, equipment: { ...state.data.equipment, [e.id]: relaxed } } }
  return placementIssue(patched, seat, item, centre, yaw) !== null
}

// ---------------------------------------------------------------------------
// Helpers used by tests and the AI
// ---------------------------------------------------------------------------

export { evalCondition, getOp }
