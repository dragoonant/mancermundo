// 3D overlays for the two continuous decisions: the deploy ghost and the move-path preview (straight-line
// increments, per-increment length and cost, climb/drop/jump labels, ghost base at the end). Every number
// shown comes from the engine's planMove; the client only draws it.
import { useMemo } from 'react'
import { Html, Line } from '@react-three/drei'
import { DoubleSide, Shape } from 'three'
import type { GameState, PendingDecision, Waypoint } from '@/engine'
import { fightTargetCard, pct, targetCard, unlistedTargets } from '../game/promptLabels'
import { BaseRing, FrontMark } from '../figures/OvalBase'
import { bearingTo, deployChoice, optionOperative, moveReach, placedMarkerRadius, previewMove, snapStep, spotOptions } from './controller'
import { useUi, type Pt } from '../ui/uiStore'

const KIND_COLOR: Record<string, string> = { walk: '#ffffff', climb: '#ff9f43', drop: '#2ee6c8', jump: '#ff5ce1' }

/** The ghost base at a spot. An oval base is drawn as its ellipse with a wedge at the front end, turned to `facing`. */
function Ghost({ x, y, z, r, ok, oval, facing = 0 }: { x: number; y: number; z: number; r: number; ok: boolean; oval?: number; facing?: number }) {
  const color = ok ? '#6dff9a' : '#ff5a4f'
  return (
    <group position={[x, y + 0.07, z]} rotation={[0, facing, 0]}>
      <BaseRing baseRadius={r} ovalHalfAxis={oval} inner={0} outer={0} solid color={color} opacity={0.35} depthWrite={false} />
      <BaseRing baseRadius={r} ovalHalfAxis={oval} inner={-r * 0.1} outer={0} color={color} y={0.005} />
      <FrontMark baseRadius={r} ovalHalfAxis={oval} color={color} y={0.006} />
    </group>
  )
}

export function DeployGhost({ state, pending }: { state: GameState; pending: PendingDecision }) {
  const hover = useUi((s) => s.hover)
  const note = useUi((s) => s.hoverNote)
  const picked = useUi((s) => s.deployOp)
  const turn = useUi((s) => s.facing)
  const id = deployChoice(pending, picked)
  const op = id ? state.operatives[id] : null
  if (!hover || !op) return null
  // an oval base faces the centre unless a facing was chosen (the engine's default)
  const facing = op.ovalHalfAxis ? (turn ?? bearingTo(hover, { x: 0, z: 0 })) : 0
  return <Ghost x={hover.x} y={hover.y} z={hover.z} r={op.baseRadius} ok={note?.ok ?? false} oval={op.ovalHalfAxis} facing={facing} />
}

function Label({ at, text, color }: { at: [number, number, number]; text: string; color: string }) {
  return (
    <Html position={at} center zIndexRange={[10, 0]} distanceFactor={16} style={{ pointerEvents: 'none' }}>
      <div style={{ background: 'rgba(8,8,14,0.82)', color, font: '700 11px system-ui', padding: '1px 5px', borderRadius: 4, whiteSpace: 'nowrap', border: `1px solid ${color}55` }}>{text}</div>
    </Html>
  )
}

export function MovePreviewLayer({ state, pending }: { state: GameState; pending: PendingDecision }) {
  const waypoints = useUi((s) => s.waypoints)
  const hover = useUi((s) => s.hover)
  const jumpNext = useUi((s) => s.jumpNext)
  const turn = useUi((s) => s.facing)
  const fly = useUi((s) => s.fly)
  const opId = pending.constraints?.operativeId
  const op = opId ? state.operatives[opId] : null
  const committed = useMemo(() => previewMove(state, pending, waypoints, turn, fly), [state, pending, waypoints, turn, fly])
  const reach = useMemo(() => moveReach(state, pending, waypoints, turn, fly), [state, pending, waypoints, turn, fly])
  const reachShape = useMemo(() => {
    if (!reach) return null
    const sh = new Shape()
    reach.points.forEach((p, i) => (i === 0 ? sh.moveTo(p.x, -p.z) : sh.lineTo(p.x, -p.z)))
    sh.closePath()
    return sh
  }, [reach])
  const whatIf = useMemo(() => {
    if (!hover) return null
    const raw: Waypoint = { x: hover.x, z: hover.z, y: hover.y, ...(jumpNext ? { jump: true } : {}) }
    const wp = fly ? raw : snapStep(state, pending, waypoints, raw, turn)
    return { at: { x: wp.x, y: hover.y, z: wp.z }, ...previewMove(state, pending, fly ? [wp] : [...waypoints, wp], turn, fly) }
  }, [state, pending, waypoints, hover, jumpNext, turn, fly])
  if (!op) return null
  const start: [number, number, number] = [op.pos.x, op.pos.y + 0.12, op.pos.z]
  const segs = committed.plan?.segments ?? []
  const last = waypoints[waypoints.length - 1]
  const lastPt: [number, number, number] = last ? [last.x, (last.y ?? op.pos.y) + 0.12, last.z] : start
  const showReach = reach && reachShape && !jumpNext
  const reachRim = showReach ? reach.points.map((p) => [p.x, reach.centre.y + 0.06, p.z] as [number, number, number]) : []
  const farthest = showReach ? reach.points.reduce((a, p) => (Math.hypot(p.x - reach.centre.x, p.z - reach.centre.z) > Math.hypot(a.x - reach.centre.x, a.z - reach.centre.z) ? p : a), reach.points[0]!) : null
  return (
    <group>
      {showReach && reachShape && farthest && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, reach.centre.y + 0.04, 0]} renderOrder={2}>
            <shapeGeometry args={[reachShape]} />
            <meshBasicMaterial color="#4fc3ff" transparent opacity={0.25} side={DoubleSide} depthWrite={false} />
          </mesh>
          <Line points={[...reachRim, reachRim[0]!]} color="#4fc3ff" lineWidth={2.5} />
          <Label at={[farthest.x, reach.centre.y + 0.5, farthest.z]} text={`${reach.left}″ left`} color="#4fc3ff" />
        </>
      )}
      {segs.map((s, i) => (
        <group key={i}>
          <Line points={[[s.from.x, s.from.y + 0.12, s.from.z], [s.to.x, s.to.y + 0.12, s.to.z]]} color={KIND_COLOR[s.kind] ?? '#fff'} lineWidth={3} />
          <Label
            at={[(s.from.x + s.to.x) / 2, Math.max(s.from.y, s.to.y) + 0.6, (s.from.z + s.to.z) / 2]}
            text={`${s.length.toFixed(1)}″${s.kind !== 'walk' ? ` ${s.kind}` : ''} (${s.cost})`}
            color={KIND_COLOR[s.kind] ?? '#fff'}
          />
        </group>
      ))}
      {committed.plan === null && waypoints.length > 0 && (
        <Line points={[start, ...waypoints.map((w) => [w.x, (w.y ?? op.pos.y) + 0.12, w.z] as [number, number, number])]} color="#ff5a4f" lineWidth={3} />
      )}
      {committed.plan ? (
        <Ghost x={committed.plan.end.x} y={committed.plan.end.y} z={committed.plan.end.z} r={op.baseRadius} ok oval={op.ovalHalfAxis} facing={committed.plan.facing} />
      ) : last ? (
        <Ghost x={last.x} y={last.y ?? 0} z={last.z} r={op.baseRadius} ok={false} oval={op.ovalHalfAxis} facing={turn ?? op.facing} />
      ) : null}
      {hover && whatIf && (
        <>
          <Line
            points={[lastPt, [whatIf.at.x, whatIf.at.y + 0.12, whatIf.at.z]]}
            color={whatIf.ok ? '#6dff9a' : '#ff5a4f'}
            lineWidth={2}
            dashed
            dashSize={0.3}
            gapSize={0.2}
          />
          <Label
            at={[whatIf.at.x, whatIf.at.y + 1.1, whatIf.at.z]}
            text={whatIf.plan ? `total ${whatIf.plan.cost}/${whatIf.plan.maxInches}″` : (whatIf.rejection?.reason ?? 'blocked').slice(0, 56)}
            color={whatIf.ok ? '#6dff9a' : '#ff8a80'}
          />
        </>
      )}
    </group>
  )
}

// ---------------------------------------------------------------- targeting, spots and placement overlays

const BADGE_COLOR: Record<string, string> = {
  valid: '#6dff9a',
  cover: '#ffb347',
  improved: '#ff9a3c',
  obscured: '#c58cff',
  choice: '#c58cff',
  unseen: '#8a8f9f',
}

/** Above every enemy while a target is being chosen: the engine's verdict badge, expected damage and kill odds. */
export function TargetBadges({ state, pending }: { state: GameState; pending: PendingDecision }) {
  const hover = useUi((s) => s.hoverOp)
  if (pending.kind !== 'shoot.target' && pending.kind !== 'fight.target') return null
  if (pending.context.secondary === true) return null
  const listed = new Set<string>()
  const labels: { id: string; text: string; color: string }[] = []
  for (const o of pending.options ?? []) {
    const id = optionOperative(o)
    if (!id) continue
    listed.add(id)
    if (pending.kind === 'shoot.target') {
      const c = targetCard(o, state)
      labels.push({ id, text: `${c.badge.label}${c.expectedDamage !== null ? ` · ${c.expectedDamage.toFixed(1)} dmg` : ''}${c.killProbability !== null ? ` · ${pct(c.killProbability)} kill` : ''}`, color: BADGE_COLOR[c.badge.kind] ?? '#fff' })
    } else {
      const c = fightTargetCard(o, state)
      labels.push({ id, text: c.line, color: '#ffd45a' })
    }
  }
  if (pending.kind === 'shoot.target') {
    for (const u of unlistedTargets(state, pending)) labels.push({ id: u.id, text: 'not visible', color: BADGE_COLOR.unseen! })
  }
  return (
    <group>
      {labels.map((l) => {
        const op = state.operatives[l.id]
        if (!op) return null
        const hot = hover === l.id
        return (
          <group key={l.id}>
            <group position={[op.pos.x, op.pos.y, op.pos.z]} rotation={[0, op.facing, 0]}>
              <BaseRing baseRadius={op.baseRadius} ovalHalfAxis={op.ovalHalfAxis} inner={0.1} outer={hot ? 0.42 : 0.28} color={l.color} opacity={hot ? 1 : 0.8} y={0.09} />
            </group>
            <Html position={[op.pos.x, op.pos.y + op.height + 1.7, op.pos.z]} center zIndexRange={[10, 0]} distanceFactor={16} style={{ pointerEvents: 'none' }}>
              <div
                data-testid={`board-badge-${l.id}`}
                style={{ background: 'rgba(8,8,14,0.88)', color: l.color, font: '700 11px system-ui', padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', border: `1px solid ${l.color}88` }}
              >
                {l.text}
              </div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}

/** Ringed spots for objective placement and spot-style choices; the hovered one is bright. */
export function SpotRings({ pending }: { pending: PendingDecision }) {
  const hoverSpot = useUi((s) => s.hoverSpot)
  const spots = spotOptions(pending)
  if (spots.length === 0) return null
  return (
    <group>
      {spots.map((s) => {
        const hot = hoverSpot === s.id
        return (
          <group key={s.id} position={[s.x, 0.12, s.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[hot ? 0.7 : 0.45, hot ? 0.95 : 0.6, 28]} />
              <meshBasicMaterial color={hot ? '#ffe066' : '#6dff9a'} transparent opacity={hot ? 1 : 0.75} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
              <circleGeometry args={[hot ? 0.7 : 0.45, 24]} />
              <meshBasicMaterial color={hot ? '#ffe066' : '#6dff9a'} transparent opacity={0.25} depthWrite={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

function Territory({ poly }: { poly: { x: number; z: number }[] }) {
  const shape = useMemo(() => {
    const sh = new Shape()
    poly.forEach((p, i) => (i === 0 ? sh.moveTo(p.x, -p.z) : sh.lineTo(p.x, -p.z)))
    sh.closePath()
    return sh
  }, [poly])
  const pts = useMemo(() => [...poly, poly[0]!].map((p) => [p.x, 0.07, p.z] as [number, number, number]), [poly])
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} renderOrder={3}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color="#6dff9a" transparent opacity={0.16} side={DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={pts} color="#6dff9a" lineWidth={2} transparent opacity={0.85} />
    </group>
  )
}

/** Free placement: the legal area (equipment territory, or the reach ring around the operative), the engine's suggestion and a hover ghost. */
export function PlaceOverlay({ state, pending }: { state: GameState; pending: PendingDecision }) {
  const hover = useUi((s) => s.hover)
  const note = useUi((s) => s.hoverNote)
  const hoverSpot = useUi((s) => s.hoverSpot)
  if (pending.kind !== 'marker.place' && pending.kind !== 'setup.equipMarker') return null
  const r = placedMarkerRadius(state, pending)
  const territory = pending.kind === 'setup.equipMarker' ? ((pending.context.territory as { x: number; z: number }[] | null) ?? null) : null
  const suggestion = pending.kind === 'setup.equipMarker' ? (pending.context.suggestion as { x: number; z: number } | undefined) : undefined
  const op = pending.kind === 'marker.place' ? state.operatives[String(pending.context.operativeId)] : null
  const reach = Number(pending.context.maxDistance ?? 1)
  return (
    <group>
      {territory && territory.length > 2 && <Territory poly={territory} />}
      {op && (
        <mesh position={[op.pos.x, op.pos.y + 0.1, op.pos.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[op.baseRadius + reach - 0.05, op.baseRadius + reach + 0.05, 48]} />
          <meshBasicMaterial color="#6dff9a" />
        </mesh>
      )}
      {suggestion && (
        <group position={[suggestion.x, 0.1, suggestion.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[Math.max(0.3, r), Math.max(0.3, r) + 0.12, 28]} />
            <meshBasicMaterial color={hoverSpot === 'suggestion' ? '#ffe066' : '#9ad7ff'} transparent opacity={0.9} />
          </mesh>
        </group>
      )}
      {hover && <Ghost x={hover.x} y={0} z={hover.z} r={Math.max(0.3, r)} ok={note?.ok ?? false} />}
    </group>
  )
}
