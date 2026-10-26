// MSN: mission.* - Preliminary Ops: objective placement, the crit op actions (Secure, Loot,
// Transmission), kill op grades, end-of-turning-point scoring, VP and the battle result (docs/spec/11-missions.md).
import { composeMissionMap, missionMap } from './bundle'
import { killOpIgnored } from './conditions'
import { baseGap2D, circleInsidePolygon, distPointSegment } from './geometry'
import { markerControl } from './query'
import { stubModule, type Ctx } from './registry'
import { allOps, otherSeat, SEATS } from './state'
import type { GameState, Marker, MissionState, Operative, RuntimeMission, Seat, Vec2 } from './types'

type Scoring = RuntimeMission['scoring'][number]

export function missionDef(state: GameState): RuntimeMission | null {
  return state.mission ? (state.data.missions?.[state.mission.id] ?? null) : null
}

/** Ability ids of the mission's actions (Secure / Loot / Initiate Transmission). */
export function missionActionIds(state: GameState): string[] {
  return missionDef(state)?.actions ?? []
}

export const OBJECTIVE_RADIUS = 40 / 25.4 / 2

// ---------------------------------------------------------------------------
// Choosing the mission and the map
// ---------------------------------------------------------------------------

/** Mission records of the pack in crit op roll order (1 Secure, 2 Loot, 3 Transmission). */
export function missionByCritRoll(state: GameState, roll: number): RuntimeMission | null {
  const all = Object.values(state.data.missions ?? {})
  return all.find((m) => m.critOpRoll === roll) ?? null
}

export function mapIdByRoll(mission: RuntimeMission, roll: number): string {
  const m = mission.maps.find((x) => roll >= x.mapRoll.min && roll <= x.mapRoll.max)
  return (m ?? mission.maps[0]!).id
}

/** Rolls (when the setup does not fix them) and applies the mission and map. Called once the setup initiative is decided. */
export function chooseMission(ctx: Ctx): void {
  const s = ctx.state
  const want = s.origin.setup.mission
  if (!want || !s.data.missions) return
  const seat = s.setup.setupInitiative ?? 'A'
  let mission: RuntimeMission | null = want.missionId ? (s.data.missions[want.missionId] ?? null) : null
  if (!mission) {
    const [d] = ctx.roll('setup.critOp', 1)
    const d3 = Math.ceil(d! / 2)
    mission = missionByCritRoll(s, d3) ?? Object.values(s.data.missions)[0]!
  }
  let mapId = want.mapId
  if (!mapId) {
    const [d] = ctx.roll('setup.map', 1)
    mapId = mapIdByRoll(mission, d!)
  }
  startMission(ctx, mission, mapId, seat)
}

export function startMission(ctx: Ctx, mission: RuntimeMission, mapId: string, rollSeat: Seat): void {
  const s = ctx.state
  s.map = composeMissionMap(s.map, missionMap(mission, mapId))
  const startCount: Record<Seat, number> = { A: 0, B: 0 }
  for (const op of allOps(s)) if (!killOpIgnored(s, op)) startCount[op.seat] += 1
  const m: MissionState = {
    id: mission.id,
    mapId,
    critOp: mission.critOp,
    startCount,
    kills: { A: 0, B: 0 },
    grade: { A: 0, B: 0 },
    secured: {},
    transmitting: [],
    looted: [],
    scored: {},
    scoredTp: {},
    objectiveStep: 0,
    counted: [],
  }
  s.mission = m
  ctx.emit({ type: 'MissionChosen', missionId: mission.id, mapId }, rollSeat)
}

// ---------------------------------------------------------------------------
// Objective markers (M-1.3)
// ---------------------------------------------------------------------------

type Step = RuntimeMission['objectiveSetup']['steps'][number]

function territoryIndex(state: GameState, pos: Vec2, r: number): number {
  const terr = state.map.meta?.territories ?? []
  for (let i = 0; i < terr.length; i++) if (circleInsidePolygon(pos, r, terr[i]!)) return i
  return -1
}

/** Seat that places the next objective marker, or null when all are placed. */
export function objectiveSeat(state: GameState): Seat | null {
  const def = missionDef(state)
  const m = state.mission
  if (!def || !m) return null
  const step = def.objectiveSetup.steps[m.objectiveStep]
  if (!step) return null
  const init = state.setup.setupInitiative ?? 'A'
  return step.by === 'initiative' ? init : otherSeat(init)
}

function spotLegal(state: GameState, step: Step, pos: Vec2, placed: Marker[]): boolean {
  const meta = state.map.meta
  if (!meta) return false
  const c = step.constraints
  const r = OBJECTIVE_RADIUS
  if (c.onCentreline && distPointSegment(pos, meta.centreline.a, meta.centreline.b) > 1e-6) return false
  if (c.minFromNeutralEdges !== undefined) {
    for (const e of meta.neutralEdges) if (distPointSegment(pos, e.a, e.b) - r <= c.minFromNeutralEdges) return false
  }
  if (c.withinCentrelineInches !== undefined && distPointSegment(pos, meta.centreline.a, meta.centreline.b) - r > c.withinCentrelineInches) return false
  if (c.minFromOtherMarkers !== undefined) {
    for (const o of placed) if (baseGap2D(pos, r, o.pos, r) <= c.minFromOtherMarkers) return false
  }
  const terr = territoryIndex(state, pos, r)
  if (c.whollyWithinTerritory && terr < 0) return false
  if (c.differentTerritoryFromPrevious) {
    // RULING: the previous marker inside a territory fixes the side; the next must take the other.
    for (let i = placed.length - 1; i >= 0; i--) {
      const t = territoryIndex(state, placed[i]!.pos, r)
      if (t >= 0) {
        if (t === terr) return false
        break
      }
    }
  }
  return true
}

/** Candidate spots (from the killzone layout) that satisfy the current step's constraints. */
export function objectiveOptions(state: GameState): Vec2[] {
  const def = missionDef(state)
  const m = state.mission
  const spots = state.map.meta?.objectiveSpots
  if (!def || !m || !spots) return []
  const step = def.objectiveSetup.steps[m.objectiveStep]
  if (!step) return []
  const placed = state.markers.filter((k) => k.kind === 'objective')
  const pool = [...spots.centre, ...spots.territoryA, ...spots.territoryB]
  const legal = pool.filter((p) => spotLegal(state, step, p, placed))
  if (legal.length > 0) return legal
  // fall back to the layout's default triple so a game can always start
  const d = spots.default
  return [m.objectiveStep === 0 ? d.centre : m.objectiveStep === 1 ? d.a : d.b]
}

export function placeObjective(ctx: Ctx, pos: Vec2, seat: Seat): void {
  const s = ctx.state
  const marker: Marker = {
    id: `obj${s.markers.filter((k) => k.kind === 'objective').length + 1}`,
    kind: 'objective',
    pos: { x: pos.x, z: pos.z },
    owner: null,
    carriedBy: null,
    controller: null,
  }
  s.markers.push(marker)
  s.mission!.objectiveStep += 1
  ctx.emit({ type: 'ObjectivePlaced', markerId: marker.id, pos: { x: pos.x, z: pos.z } }, seat)
}

// ---------------------------------------------------------------------------
// Kill op
// ---------------------------------------------------------------------------

/**
 * M9 prep (reanimation): an incapacitated operative came back, so it no longer counts towards the
 * opponent's kill grade. The grade is recomputed from the current count; VP that kill grade rules gave
 * for grades no longer held are taken back (and given again if the grade is regained). RULING logged.
 */
export function onOperativeReturned(ctx: Ctx, op: Operative): void {
  const s = ctx.state
  const m = s.mission
  const def = missionDef(s)
  if (!m || !def || !m.counted.includes(op.id)) return
  m.counted = m.counted.filter((id) => id !== op.id)
  if (killOpIgnored(s, op)) return
  const scorer = otherSeat(op.seat)
  m.kills[scorer] = Math.max(0, m.kills[scorer] - 1)
  const grade = gradeFor(gradeThresholds(s, scorer), m.kills[scorer])
  if (grade >= m.grade[scorer]) return
  const lost = m.grade[scorer] - grade
  m.grade[scorer] = grade
  ctx.emit({ type: 'KillGradeChanged', grade, kills: m.kills[scorer] }, scorer)
  for (const rule of rulesFor(def, 'killGradeIncreased')) {
    const scored = (m.scored[rule.id] ??= { A: 0, B: 0 })
    const back = Math.min(scored[scorer], rule.vp * lost)
    if (back <= 0) continue
    scored[scorer] -= back
    s.players[scorer].vp -= back
    ctx.emit({ type: 'VpScored', amount: -back, vp: s.players[scorer].vp, ruleId: rule.id }, scorer)
  }
}

/** Enemy incapacitations `seat` needs for kill grades 1..5, from the enemy's starting (non-Expendable) count. */
export function gradeThresholds(state: GameState, seat: Seat): number[] {
  const def = missionDef(state)
  const m = state.mission
  if (!def || !m) return []
  const table = def.killOp.gradeTable
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b)
  const n = m.startCount[otherSeat(seat)]
  let key = n
  if (!(String(key) in table)) key = n < keys[0]! ? keys[0]! : keys[keys.length - 1]!
  return [...table[String(key)]!]
}

function gradeFor(thresholds: readonly number[], kills: number): number {
  let g = 0
  for (const t of thresholds) if (kills >= t) g++
  return g
}

function rulesFor(def: RuntimeMission, metric: Scoring['metric']): Scoring[] {
  return def.scoring.filter((r) => r.metric === metric)
}

/** Award a rule's VP within its caps (per battle, per turning point and cap group). Returns the VP given. */
function award(ctx: Ctx, seat: Seat, rule: Scoring, times = 1): number {
  const s = ctx.state
  const m = s.mission!
  let amount = rule.vp * times
  const ruleScored = (m.scored[rule.id] ??= { A: 0, B: 0 })
  if (rule.maxPerBattle !== undefined) amount = Math.min(amount, rule.maxPerBattle - ruleScored[seat])
  const group = rule.capGroup ?? rule.id
  const tpScored = (m.scoredTp[group] ??= { A: 0, B: 0 })
  if (rule.maxPerTurningPoint !== undefined) amount = Math.min(amount, rule.maxPerTurningPoint - tpScored[seat])
  if (amount <= 0) return 0
  ruleScored[seat] += amount
  tpScored[seat] += amount
  s.players[seat].vp += amount
  ctx.emit({ type: 'VpScored', amount, vp: s.players[seat].vp, ruleId: rule.id }, seat)
  return amount
}

/** A removed operative counts towards the enemy's kill grade unless it is Expendable (M-2.2). */
export function onOperativeRemoved(ctx: Ctx, op: Operative): void {
  const s = ctx.state
  const m = s.mission
  const def = missionDef(s)
  if (!m || !def || m.counted.includes(op.id)) return
  m.counted.push(op.id)
  if (killOpIgnored(s, op)) return
  const scorer = otherSeat(op.seat)
  m.kills[scorer] += 1
  const grade = gradeFor(gradeThresholds(s, scorer), m.kills[scorer])
  if (grade > m.grade[scorer]) {
    const gained = grade - m.grade[scorer]
    m.grade[scorer] = grade
    ctx.emit({ type: 'KillGradeChanged', grade, kills: m.kills[scorer] }, scorer)
    for (const rule of rulesFor(def, 'killGradeIncreased')) award(ctx, scorer, rule, gained)
  }
}

// ---------------------------------------------------------------------------
// Crit ops
// ---------------------------------------------------------------------------

export function securedCount(state: GameState, seat: Seat): number {
  return Object.values(state.mission?.secured ?? {}).filter((x) => x === seat).length
}

export function transmittingControlled(state: GameState, seat: Seat): number {
  let n = 0
  for (const id of state.mission?.transmitting ?? []) {
    const marker = state.markers.find((k) => k.id === id)
    if (marker && markerControl(state, marker).controller === seat) n++
  }
  return n
}

export function markSecured(ctx: Ctx, seat: Seat, markerId: string): void {
  ctx.state.mission!.secured[markerId] = seat
}

export function markTransmitting(ctx: Ctx, markerId: string): void {
  const m = ctx.state.mission!
  if (!m.transmitting.includes(markerId)) m.transmitting.push(markerId)
}

/** Loot: the marker is looted this TP and the looter scores 1 VP within the TP cap (M-3.3, M-3.4). */
export function markLooted(ctx: Ctx, seat: Seat, markerId: string): void {
  const s = ctx.state
  const m = s.mission!
  m.looted.push(markerId)
  const def = missionDef(s)
  if (!def) return
  for (const rule of rulesFor(def, 'lootPerformed')) {
    if (rule.fromTurningPoint !== undefined && s.turningPoint < rule.fromTurningPoint) continue
    award(ctx, seat, rule)
  }
}

function metricValue(state: GameState, rule: Scoring, seat: Seat): number {
  switch (rule.metric) {
    case 'securedMarkers':
      return securedCount(state, seat)
    case 'transmittingMarkersControlled':
      return transmittingControlled(state, seat)
    case 'killGrade':
      return state.mission!.grade[seat]
    default:
      return 0
  }
}

function scoreWindow(ctx: Ctx, window: 'turningPoint.end' | 'battle.end'): void {
  const s = ctx.state
  const def = missionDef(s)
  if (!def || !s.mission) return
  for (const rule of def.scoring) {
    const ws = Array.isArray(rule.window) ? rule.window : [rule.window]
    if (!ws.includes(window)) continue
    if (rule.cmp === 'event') continue
    if (rule.fromTurningPoint !== undefined && s.turningPoint < rule.fromTurningPoint) continue
    for (const seat of SEATS) {
      const mine = metricValue(s, rule, seat)
      const theirs = metricValue(s, rule, otherSeat(seat))
      const ok = rule.cmp === 'gte' ? mine >= (rule.value ?? 1) : mine > theirs
      if (ok) award(ctx, seat, rule)
    }
  }
}

/** End of a turning point (after the Firefight phase): crit op scoring (M-4.2). */
export function scoreTurningPointEnd(ctx: Ctx): void {
  scoreWindow(ctx, 'turningPoint.end')
}

/** End of the last turning point: the kill op comparison (M-2.1). */
export function scoreBattleEnd(ctx: Ctx): void {
  scoreWindow(ctx, 'battle.end')
}

/** The start of a turning point ends transmitting and resets per-TP scoring caps (R-2.6). */
export function onTurningPointStart(ctx: Ctx): void {
  const m = ctx.state.mission
  if (!m) return
  m.transmitting = []
  m.looted = []
  m.scoredTp = {}
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface MissionView {
  id: string
  name: string
  critOp: string
  mapId: string
  turningPoint: number
  vp: Record<Seat, number>
  kill: Record<Seat, { grade: number; kills: number; thresholds: number[]; next: number | null; startingEnemies: number }>
  markers: {
    id: string
    pos: Vec2
    controller: Seat | null
    securedBy: Seat | null
    transmitting: boolean
    looted: boolean
    contesting: Record<Seat, string[]>
  }[]
  /** crit op VP each seat can still score this turning point under the per-TP cap */
  critRoomThisTp: Record<Seat, number>
}

/** `query.mission`: everything the UI shows about the mission, computed by the engine. */
export function missionView(state: GameState): MissionView | null {
  const m = state.mission
  const def = missionDef(state)
  if (!m || !def) return null
  const kill = {} as MissionView['kill']
  for (const seat of SEATS) {
    const thresholds = gradeThresholds(state, seat)
    const next = thresholds.find((t) => t > m.kills[seat]) ?? null
    kill[seat] = { grade: m.grade[seat], kills: m.kills[seat], thresholds, next, startingEnemies: m.startCount[otherSeat(seat)] }
  }
  const critRoomThisTp = { A: 0, B: 0 }
  const cap = def.scoring.find((r) => r.op === 'crit' && r.maxPerTurningPoint !== undefined)
  if (cap) {
    const group = cap.capGroup ?? cap.id
    for (const seat of SEATS) critRoomThisTp[seat] = Math.max(0, (cap.maxPerTurningPoint ?? 0) - (m.scoredTp[group]?.[seat] ?? 0))
  }
  return {
    id: m.id,
    name: def.name,
    critOp: m.critOp,
    mapId: m.mapId,
    turningPoint: state.turningPoint,
    vp: { A: state.players.A.vp, B: state.players.B.vp },
    kill,
    markers: state.markers
      .filter((k) => k.kind === 'objective')
      .map((k) => {
        const c = markerControl(state, k)
        return {
          id: k.id,
          pos: { ...k.pos },
          controller: c.controller,
          securedBy: m.secured[k.id] ?? null,
          transmitting: m.transmitting.includes(k.id),
          looted: m.looted.includes(k.id),
          contesting: c.contesting,
        }
      }),
    critRoomThisTp,
  }
}

// `mission.action` and `mission.*` decisions are not used: mission actions are options of firefight.action.
export const missionsModule = stubModule('missions', ['mission'])
