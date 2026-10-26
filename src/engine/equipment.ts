// EQP: equip.* - universal and faction equipment: selection checks, the alternating placement of
// markers and terrain in set-up (setup.equipMarker), granted weapons and their team-wide limits.
// Rules: docs/spec/11-missions.md M-5, docs/spec/13-teams.md faction equipment.
import {
  circleInsidePolygon,
  distPointSegment,
  distToPolygon,
  pointInPolygon,
  polygonBBox,
  round3,
} from './geometry'
import { addUse, usesOf } from './effects'
import { fnv1a } from './rng'
import { markFired } from './code-hooks'
import { hasKeyword, isExpendable } from './conditions'
import { newMarkerId } from './markers'
import { stubModule, type Ctx, type Handled } from './registry'
import { otherSeat, SEATS } from './state'
import { terrainOf } from './terrain'
import type {
  EquipItem,
  GameSetup,
  GameState,
  MapDef,
  Marker,
  Operative,
  Polygon,
  Rejection,
  RuntimeEquipment,
  Seat,
  TerrainFeatureDef,
  TerrainTrait,
  Vec2,
} from './types'

export const DEFAULT_EQUIPMENT_LIMIT = 4
const MARKER_RADIUS = 20 / 25.4 / 2

/** Footprint (long side along the facing, short side across) of each terrain item, in inches. Own sizes: the sources print none. */
const FOOTPRINTS: Record<string, { w: number; h: number }> = {
  'core.e.razor-wire': { w: 3, h: 0.5 },
  'core.e.light-barricades': { w: 2, h: 0.5 },
  'core.e.heavy-barricade': { w: 3, h: 0.5 },
  'core.e.portable-barricade': { w: 2, h: 0.5 },
  'core.e.ladders': { w: 0.5, h: 1 },
}

export function equipmentDef(state: GameState, id: string): RuntimeEquipment | undefined {
  return state.data.equipment?.[id]
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Why an equipment selection is illegal, or null (R-1.3, R-8.10, M-5). */
export function selectionProblem(
  setup: GameSetup,
  seat: Seat,
  data: { equipment?: Record<string, RuntimeEquipment>; teamId: string; limit: number },
): string | null {
  const picks = setup.equipment?.[seat] ?? []
  if (picks.length > data.limit) return `seat ${seat} picked more than ${data.limit} equipment options`
  if (new Set(picks).size !== picks.length) return `seat ${seat} repeated an equipment option`
  if (!data.equipment) return null
  for (const id of picks) {
    const e = data.equipment[id]
    if (!e) return `unknown equipment ${id}`
    if (e.enabled === false) return `${e.name} is not offered`
    if (e.scope === 'faction' && e.team !== data.teamId) return `${e.name} belongs to another team`
    if (e.choice) {
      const chosen = setup.equipmentChoices?.[seat]?.[id] ?? []
      if (chosen.length !== e.choice.pick) return `${e.name}: pick ${e.choice.pick} (${e.choice.from.join(' / ')})`
      if (!chosen.every((c) => e.choice!.from.includes(c))) return `${e.name}: illegal pick`
      if (!e.choice.repeatable && new Set(chosen).size !== chosen.length) return `${e.name}: picks must differ`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Game creation: queue, ledger totals, granted weapons
// ---------------------------------------------------------------------------

export const TEAM_LIMIT_PREFIX = 'limit:'

/** Weapons whose use is limited team-wide: id -> { seat's total, per }. */
export interface TeamLimit {
  weaponId: string
  total: number
  per: 'battle' | 'turningPoint'
}

export function teamLimits(state: GameState, seat: Seat): TeamLimit[] {
  const out: TeamLimit[] = []
  for (const id of state.players[seat].equipment) {
    const e = equipmentDef(state, id)
    if (!e) continue
    if (e.choice && e.grants?.weapons) {
      const picks = state.equipment.picks[seat]?.[id] ?? []
      for (const w of e.grants.weapons) out.push({ weaponId: w, total: picks.filter((p) => p === w).length, per: 'battle' })
    } else if (e.limits && e.grants?.weapons) {
      for (const w of e.grants.weapons) out.push({ weaponId: w, total: e.limits.uses, per: e.limits.per })
    }
  }
  return out
}

function eligibleForGrant(state: GameState, op: Operative, e: RuntimeEquipment): boolean {
  const card = state.data.datacards[op.datacardId]
  if (!card) return false
  if (state.data.abilities['kom.a.stoopid'] && card.abilities.includes('kom.a.stoopid')) return false
  if (e.team === 'kommandos') return hasKeyword(state, op, 'KOMMANDO') && !hasKeyword(state, op, 'BOMB SQUIG') && !hasKeyword(state, op, 'GROT')
  return !isExpendable(state, op)
}

/** Fill state.equipment and the ledger from the setup, and give operatives the weapons equipment grants. */
export function initEquipment(state: GameState, setup: GameSetup): void {
  for (const seat of SEATS) {
    const ids = setup.equipment?.[seat] ?? []
    state.equipment.picks[seat] = { ...(setup.equipmentChoices?.[seat] ?? {}) }
    const queue: EquipItem[] = []
    for (const id of ids) {
      const e = equipmentDef(state, id)
      if (!e?.setup) continue
      for (let i = 0; i < e.count; i++) queue.push({ key: `${seat}:${id}#${i + 1}`, equipmentId: id, kind: e.setup.type })
    }
    state.equipment.queue[seat] = queue
    // grants
    for (const id of ids) {
      const e = equipmentDef(state, id)
      if (!e?.grants?.weapons) continue
      for (const op of Object.values(state.operatives)) {
        if (op.seat !== seat || !eligibleForGrant(state, op, e)) continue
        for (const w of e.grants.weapons) {
          if (!state.data.weapons[w] || op.weapons.includes(w)) continue
          // Choppas: an operative that already has a choppa keeps it (T-KOM equipment table)
          if (e.id === 'kom.e.choppas' && op.weapons.some((x) => (state.data.weapons[x]?.name ?? '').toLowerCase().includes('choppa'))) continue
          op.weapons.push(w)
          if (e.id === 'kom.e.choppas') markFired('choppasEquipment')
        }
      }
    }
  }
  // The Grenadier carries its own frag and krak grenades, separate from the team's totals (T-AOD.9).
  for (const op of Object.values(state.operatives)) {
    if (!state.data.datacards[op.datacardId]?.abilities.includes('aod.a.grenadier')) continue
    for (const w of ['core.w.frag-grenade', 'core.w.krak-grenade']) {
      if (state.data.weapons[w] && !op.weapons.includes(w)) op.weapons.push(w)
    }
  }
}

// ---------------------------------------------------------------------------
// Team-wide weapon limits (frag / krak grenades, Dynamite, Harpoon)
// ---------------------------------------------------------------------------

/**
 * Count a Shoot with a team-limited weapon and strip the weapon from the team once the totals are
 * spent (R-10.11 style; M-5.6, Dynamite once per battle, Harpoon once per turning point). Driven by
 * the ShootStarted events of the step, so the attack code needs no call.
 */
export function noteWeaponUses(ctx: Ctx): void {
  const s = ctx.state
  for (const ev of ctx.events) {
    if (ev.type !== 'ShootStarted') continue
    const op = s.operatives[ev.operativeId]
    if (!op) continue
    const w = ev.weaponId
    const own = s.data.datacards[op.datacardId]?.abilities.includes('aod.a.grenadier') && (w === 'core.w.frag-grenade' || w === 'core.w.krak-grenade')
    if (own) {
      op.usedLimited[w] = (op.usedLimited[w] ?? 0) + 1
      if (op.usedLimited[w]! >= 1) op.weapons = op.weapons.filter((x) => x !== w)
      continue
    }
    const limit = teamLimits(s, op.seat).find((l) => l.weaponId === w)
    if (!limit) continue
    const key = `${TEAM_LIMIT_PREFIX}${w}`
    if (limit.per === 'battle') addUse(s, op.seat, key)
    else s.ledger[op.seat].tpUses[key] = (s.ledger[op.seat].tpUses[key] ?? 0) + 1
    const used = limit.per === 'battle' ? usesOf(s, op.seat, key) : (s.ledger[op.seat].tpUses[key] ?? 0)
    if (used >= limit.total) {
      for (const o of Object.values(s.operatives)) if (o.seat === op.seat) o.weapons = o.weapons.filter((x) => x !== w)
    }
  }
}

/** A new turning point gives back per-TP weapons (Harpoon). */
export function restoreTurningPointWeapons(state: GameState): void {
  for (const seat of SEATS) {
    state.ledger[seat].tpUses = Object.fromEntries(Object.entries(state.ledger[seat].tpUses).filter(([k]) => !k.startsWith(TEAM_LIMIT_PREFIX)))
    for (const limit of teamLimits(state, seat)) {
      if (limit.per !== 'turningPoint') continue
      const e = state.players[seat].equipment.map((id) => equipmentDef(state, id)).find((x) => x?.grants?.weapons?.includes(limit.weaponId))
      for (const op of Object.values(state.operatives)) {
        if (op.seat !== seat || op.status === 'removed' || op.weapons.includes(limit.weaponId)) continue
        if (e && eligibleForGrant(state, op, e)) op.weapons.push(limit.weaponId)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function rectPolygon(c: Vec2, w: number, h: number, yawDeg: number): Polygon {
  const a = (yawDeg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const pts: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ]
  return pts.map(([x, z]) => ({ x: round3(c.x + x * cos - z * sin), z: round3(c.z + x * sin + z * cos) }))
}

function segsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)
  const d1 = o(a, b, c)
  const d2 = o(a, b, d)
  const d3 = o(c, d, a)
  const d4 = o(c, d, b)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Minimum distance between two polygon regions (0 when they overlap). */
export function polygonsDistance(a: Polygon, b: Polygon): number {
  for (const p of a) if (pointInPolygon(p, b)) return 0
  for (const p of b) if (pointInPolygon(p, a)) return 0
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segsIntersect(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return 0
    }
  }
  let best = Infinity
  for (const p of a) for (let j = 0; j < b.length; j++) best = Math.min(best, distPointSegment(p, b[j]!, b[(j + 1) % b.length]!))
  for (const p of b) for (let i = 0; i < a.length; i++) best = Math.min(best, distPointSegment(p, a[i]!, a[(i + 1) % a.length]!))
  return best
}

export function discPolygon(c: Vec2, r: number, sides = 12): Polygon {
  const out: Polygon = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    out.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r })
  }
  return out
}

function wholly(poly: Polygon, region: Polygon): boolean {
  return poly.every((p) => pointInPolygon(p, region))
}

/** Territory polygon of the seat: the territory of the drop zone it chose. */
export function territoryOf(state: GameState, seat: Seat): Polygon | null {
  const zone = state.map.dropZones.find((z) => z.id === state.players[seat].dropZoneId)
  return zone?.territory ?? null
}

function dropZoneOf(state: GameState, seat: Seat): Polygon | null {
  return state.map.dropZones.find((z) => z.id === state.players[seat].dropZoneId)?.polygon ?? null
}

// ---------------------------------------------------------------------------
// Placement rules
// ---------------------------------------------------------------------------

export interface PlacementSpec {
  poly: Polygon
  /** marker disc radius, or 0 for terrain */
  radius: number
  height: number
  leansOn?: string
}

function accessiblePolys(state: GameState, doorsOnly: boolean): Polygon[] {
  const idx = terrainOf(state.map)
  return idx.solids.filter((s) => s.accessible && (!doorsOnly || s.partId.includes('door'))).map((s) => s.polygon)
}

function equipmentTerrainPolys(state: GameState): Polygon[] {
  const out: Polygon[] = []
  for (const f of state.map.features) if (f.equipmentId) for (const p of f.parts) out.push(p.footprint)
  return out
}

/** Footprint a terrain item would take at the position and facing. */
export function itemFootprint(equipmentId: string, pos: Vec2, yaw: number): Polygon {
  const f = FOOTPRINTS[equipmentId] ?? { w: 1, h: 1 }
  return rectPolygon(pos, f.w, f.h, yaw)
}

/** Why an item cannot be placed there, or null (M-5.1 to M-5.10 placement constraints). */
export function placementIssue(state: GameState, seat: Seat, item: EquipItem, pos: Vec2, yaw: number): Rejection | null {
  const e = equipmentDef(state, item.equipmentId)
  if (!e?.setup) return { code: 'E_NOT_AN_OPTION', reason: 'that equipment is not placed on the killzone' }
  const bad = (reason: string): Rejection => ({ code: 'E_OUT_OF_RANGE', reason })
  const idx = terrainOf(state.map)
  const isMarker = e.setup.type === 'marker'
  const radius = isMarker ? (e.setup.markerMm ?? 20) / 25.4 / 2 : 0
  const poly = isMarker ? discPolygon(pos, radius) : itemFootprint(item.equipmentId, pos, yaw)
  const halfX = idx.halfX
  const halfZ = idx.halfZ
  if (!poly.every((p) => Math.abs(p.x) <= halfX + 1e-6 && Math.abs(p.z) <= halfZ + 1e-6)) return bad('it would cross the killzone edge')
  if (e.setup.whollyWithinTerritory) {
    const terr = territoryOf(state, seat)
    if (!terr) return bad('your territory is not known yet')
    if (isMarker ? !circleInsidePolygon(pos, radius, terr) : !wholly(poly, terr)) return bad('it must be wholly within your territory')
  }
  if (e.setup.withinDropZoneInches !== undefined) {
    const dz = dropZoneOf(state, seat)
    if (!dz) return bad('your drop zone is not known yet')
    if (!poly.every((p) => distToPolygon(p, dz) <= e.setup!.withinDropZoneInches! + 1e-6)) return bad(`it must be wholly within ${e.setup.withinDropZoneInches}" of your drop zone`)
  }
  // lies on the killzone floor: clear of every terrain footprint (ladders lean, so they touch one)
  const leans = e.id === 'core.e.ladders'
  let leansOn: string | undefined
  for (const s of idx.solids) {
    const d = polygonsDistance(poly, s.polygon)
    if (leans && d <= 0.3 && s.top >= 2) leansOn ??= s.partId
    else if (d <= 0) return bad(`it overlaps terrain (${s.partId})`)
    if (s.accessible || s.partId.includes('door')) continue
  }
  if (leans && !leansOn) return bad('a ladder is set upright against terrain at least 2" tall')
  for (const c of e.setup.clearances ?? []) {
    for (const from of c.from) {
      const polys =
        from === 'accessPoints' || from === 'accessibleTerrain'
          ? accessiblePolys(state, false)
          : from === 'doors'
            ? accessiblePolys(state, true)
            : from === 'equipmentTerrain'
              ? equipmentTerrainPolys(state)
              : []
      for (const other of polys) {
        if (polygonsDistance(poly, other) <= c.moreThan + 1e-6) return bad(`it must be more than ${c.moreThan}" from ${from}`)
      }
      if (from === 'otherMarkers') {
        for (const m of state.markers) {
          const r = m.kind === 'objective' ? 40 / 25.4 / 2 : MARKER_RADIUS
          const gap = Math.hypot(m.pos.x - pos.x, m.pos.z - pos.z) - r - radius
          if (gap <= c.moreThan + 1e-6) return bad(`it must be more than ${c.moreThan}" from other markers`)
        }
      }
    }
  }
  return null
}

/** Build the terrain feature for a placed item. */
function buildFeature(state: GameState, seat: Seat, item: EquipItem, pos: Vec2, yaw: number): TerrainFeatureDef {
  const e = equipmentDef(state, item.equipmentId)!
  const poly = itemFootprint(item.equipmentId, pos, yaw)
  const idx = terrainOf(state.map)
  let height = e.terrain?.height ?? 1
  let leansOn: string | undefined
  const traits = [...(e.terrain?.traits ?? [])] as TerrainTrait[]
  const tags = [...(e.terrain?.tags ?? [])]
  if (item.equipmentId === 'core.e.razor-wire') {
    // crossable but costly: Obstructing terrain (M-5.4)
    if (!traits.includes('insignificant')) traits.push('insignificant')
  }
  if (item.equipmentId === 'core.e.ladders') {
    for (const s of idx.solids) {
      if (polygonsDistance(poly, s.polygon) <= 0.3 && s.top >= 2) {
        // the ladder is a thin marker of where the climb is cheap; it adds no surface and blocks no line
        leansOn = s.partId
        height = 0.1
        break
      }
    }
  }
  const featureId = `eq:${item.key}`
  const feature: TerrainFeatureDef = {
    id: featureId,
    name: e.terrain?.model ?? e.name,
    equipmentId: item.equipmentId,
    owner: seat,
    parts: [{ id: `${featureId}.0`, footprint: poly, height, traits, ...(tags.length ? { tags } : {}) }],
  }
  if (leansOn) feature.leansOn = leansOn
  return feature
}

/** Apply a legal placement: create the marker or terrain, update the queue and the map. */
export function placeItem(ctx: Ctx, seat: Seat, item: EquipItem, pos: Vec2, yaw: number): void {
  const s = ctx.state
  const e = equipmentDef(s, item.equipmentId)!
  const p = { x: round3(pos.x), z: round3(pos.z) }
  const placed = { key: item.key, equipmentId: item.equipmentId, seat, kind: item.kind, pos: p, yaw }
  if (item.kind === 'marker') {
    const marker: Marker = {
      id: newMarkerId(ctx, 'eq'),
      kind: 'equipment',
      pos: p,
      owner: seat,
      carriedBy: null,
      controller: null,
      equipmentId: item.equipmentId,
      hidden: item.equipmentId === 'core.e.mines',
    }
    s.markers.push(marker)
    s.equipment.placed.push({ ...placed, markerId: marker.id })
  } else {
    const feature = buildFeature(s, seat, item, p, yaw)
    const map: MapDef = { ...s.map, features: [...s.map.features, feature] }
    s.map = map
    s.equipment.placed.push({ ...placed, featureId: feature.id })
  }
  s.equipment.queue[seat] = s.equipment.queue[seat].filter((i) => i.key !== item.key)
  ctx.emit({ type: 'EquipmentPlaced', equipmentId: item.equipmentId, key: item.key, pos: p, yaw, hidden: item.equipmentId === 'core.e.mines' }, seat)
  void e
}

/** The next seat to place: alternate item by item from the setup-initiative player (R-1.4). */
export function nextPlacer(state: GameState): Seat | null {
  const q = state.equipment.queue
  const turn = state.equipment.turn ?? state.setup.setupInitiative ?? 'A'
  if (q[turn].length > 0) return turn
  const other = otherSeat(turn)
  return q[other].length > 0 ? other : null
}

/** A legal spot for an item, by deterministic grid scan (bots, auto placement, tests). */
export function suggestEquipPlacement(state: GameState, seat: Seat, item: EquipItem, skip = 0): { x: number; z: number; yaw: number } | null {
  const terr = territoryOf(state, seat)
  if (!terr) return null
  const box = polygonBBox(terr)
  const e = equipmentDef(state, item.equipmentId)
  const leans = item.equipmentId === 'core.e.ladders'
  const yaws = leans ? [0, 90] : [0, 90]
  const candidates: Vec2[] = []
  if (leans) {
    // beside terrain at least 2" tall: just outside each side of every tall part's bounding box
    for (const sld of terrainOf(state.map).solids) {
      if (sld.top < 2) continue
      const b = sld.bbox
      const mx = (b.minX + b.maxX) / 2
      const mz = (b.minZ + b.maxZ) / 2
      const off = 0.5
      candidates.push({ x: mx, z: b.minZ - off }, { x: mx, z: b.maxZ + off }, { x: b.minX - off, z: mz }, { x: b.maxX + off, z: mz })
    }
  } else {
    const step = 0.5
    for (let z = box.minZ; z <= box.maxZ; z += step) for (let x = box.minX; x <= box.maxX; x += step) candidates.push({ x, z })
  }
  const n = candidates.length
  if (n === 0) return null
  // start the scan at a spot derived from the item so auto placement spreads out instead of piling in a corner
  const start = Number.parseInt(fnv1a(item.key), 16) % n
  for (let k = 0; k < n; k++) {
    const c = candidates[(k + start + skip) % n]!
    for (const yaw of yaws) {
      if (!placementIssue(state, seat, item, c, yaw)) return { x: round3(c.x), z: round3(c.z), yaw }
    }
  }
  void e
  return null
}

/** Handler for a setup.equipMarker answer. */
export function handleEquipMarker(state: GameState, seat: Seat, payload: { x?: unknown; z?: unknown; yaw?: unknown }): Handled {
  const item = state.equipment.queue[seat][0]
  if (!item) return { rejection: { code: 'E_WRONG_DECISION', reason: 'nothing to place' } }
  if (typeof payload.x !== 'number' || typeof payload.z !== 'number' || !Number.isFinite(payload.x) || !Number.isFinite(payload.z)) {
    return { rejection: { code: 'E_SCHEMA', reason: 'a placement needs x and z' } }
  }
  const yaw = typeof payload.yaw === 'number' && Number.isFinite(payload.yaw) ? payload.yaw : 0
  const issue = placementIssue(state, seat, item, { x: payload.x, z: payload.z }, yaw)
  if (issue) return { rejection: issue }
  return {
    run(ctx) {
      placeItem(ctx, seat, item, { x: payload.x as number, z: payload.z as number }, yaw)
    },
  }
}

// no `equip.*` decisions exist: equipment actions are firefight.action options (abilities.ts)
export const equipmentModule = stubModule('equipment', ['equip'])
export { distPointSegment }
