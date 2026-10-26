// 3D overlays for the pending decision, drawn over the board: the deployment strips and a ghost base, the move preview (route,
// inches used and left, the reach ring), target badges with the engine's odds, doors that have an action, and the transient
// effects (tracers, impacts, floating text) the director spawns. Flat meshes sit just above the deck with polygon offset and no
// depth writes so they never z-fight. Every number shown comes from the engine through the controller.
import { useMemo } from 'react'
import { Html, Line } from '@react-three/drei'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { BoardDef, GameState, PendingDecision, Polygon, Vec2 } from '@/engine'
import { flatPolygonGeometry } from '../board/zmGeometry'
import { optionFacts, optionDoor, optionFighter } from '../game/labels'
import { useFx } from '../presentation/fxStore'
import { deployFacing, deployFighterFor, routeTo } from './controller'
import { useUi } from '../ui/uiStore'
import { colors } from '../ui/theme'

const ZONE_Y = 0.04
const MARK_Y = 0.07

const flat = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 } as const

function ZonePoly({ poly, colour }: { poly: Polygon; colour: string }) {
  const fill = useMemo(() => flatPolygonGeometry(poly, ZONE_Y), [poly])
  const edge = useMemo(() => {
    const g = new BufferGeometry()
    const p: number[] = []
    for (const v of poly) p.push(v.x, ZONE_Y + 0.004, v.z)
    g.setAttribute('position', new Float32BufferAttribute(p, 3))
    return g
  }, [poly])
  return (
    <group>
      <mesh geometry={fill} renderOrder={2}>
        <meshBasicMaterial color={colour} opacity={0.22} {...flat} />
      </mesh>
      <lineLoop geometry={edge} renderOrder={3}>
        <lineBasicMaterial color={colour} transparent opacity={0.85} depthWrite={false} />
      </lineLoop>
    </group>
  )
}

function Ring({ at, r, colour, width = 0.14, opacity = 0.9 }: { at: Vec2; r: number; colour: string; width?: number; opacity?: number }) {
  return (
    <mesh position={[at.x, MARK_Y, at.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
      <ringGeometry args={[Math.max(0.01, r - width), r, 40]} />
      <meshBasicMaterial color={colour} opacity={opacity} {...flat} />
    </mesh>
  )
}

function Tag({ at, y = 0.4, children, tone = 'info' }: { at: Vec2; y?: number; children: React.ReactNode; tone?: 'info' | 'ok' | 'bad' }) {
  const border = tone === 'ok' ? '#3fc46b' : tone === 'bad' ? colors.danger : colors.border
  return (
    <Html position={[at.x, y, at.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div
        data-testid="board-tag"
        style={{
          background: 'rgba(14,15,22,0.92)',
          color: colors.text,
          border: `1px solid ${border}`,
          borderRadius: 6,
          padding: '3px 8px',
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          fontFamily: 'system-ui, sans-serif',
          boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
        }}
      >
        {children}
      </div>
    </Html>
  )
}

// ---------------------------------------------------------------- deployment

/** The seat's deployment strips and the ghost base under the pointer, green when the engine would accept the spot. */
export function DeployLayer({ state, pending }: { state: GameState; pending: PendingDecision }) {
  const hover = useUi((s) => s.hover)
  const note = useUi((s) => s.hoverNote)
  const picked = useUi((s) => s.deployFighter)
  const facingChoice = useUi((s) => s.facing)
  const regions = (pending.context.regions as Polygon[] | undefined) ?? (pending.constraints?.region ? [pending.constraints.region] : [])
  const id = deployFighterFor(pending, picked)
  const f = id ? state.fighters[id] : undefined
  const r = f?.baseRadius ?? 0.5
  const facing = deployFacing(pending, facingChoice)
  const colour = pending.seat === 'A' ? colors.playerA : colors.playerB
  return (
    <group name="deploy-layer">
      {regions.map((poly, i) => (
        <ZonePoly key={i} poly={poly} colour={colour} />
      ))}
      {hover && f && (
        <group position={[hover.x, 0, hover.z]}>
          <Ring at={{ x: 0, z: 0 }} r={r} colour={note?.ok ? '#3fc46b' : colors.danger} width={0.22} />
          <mesh position={[Math.sin(facing) * (r + 0.4), MARK_Y, Math.cos(facing) * (r + 0.4)]} rotation={[-Math.PI / 2, 0, -facing]} renderOrder={5}>
            <coneGeometry args={[0.28, 0.6, 3]} />
            <meshBasicMaterial color={note?.ok ? '#3fc46b' : colors.danger} {...flat} />
          </mesh>
          {note && (
            <Tag at={{ x: 0, z: 0 }} y={1.1} tone={note.ok ? 'ok' : 'bad'}>
              {f.name}: {note.text}
            </Tag>
          )}
        </group>
      )}
    </group>
  )
}

// ---------------------------------------------------------------- move preview

const inch = (n: number): string => `${Math.round(n * 10) / 10}"`

/** The move being planned: the allowance ring, the engine's route to the pointer, and the inches used and left. */
export function MovePreviewLayer({ state, pending }: { state: GameState; pending: PendingDecision }) {
  const hover = useUi((s) => s.hover)
  const c = pending.constraints
  const f = c?.fighterId ? state.fighters[c.fighterId] : undefined
  const route = useMemo(() => (hover && f ? routeTo(state, pending, hover) : null), [state, pending, hover, f])
  if (!f || !c) return null
  const max = c.maxInches ?? Number(pending.context.maxInches ?? 0)
  const start: Vec2 = { x: f.pos.x, z: f.pos.z }
  const pts: [number, number, number][] = route?.ok ? [[start.x, MARK_Y + 0.05, start.z], ...route.waypoints.map((w): [number, number, number] => [w.x, MARK_Y + 0.05, w.z])] : []
  const tone = route?.ok ? (route.short ? '#f5d95a' : '#3fc46b') : colors.danger
  return (
    <group name="move-preview">
      {/* the allowance, drawn as if the board were open; walls and bases are the engine's verdict on the route */}
      <Ring at={start} r={max + f.baseRadius} colour="#ffffff" width={0.06} opacity={0.35} />
      {route?.ok && route.end && (
        <>
          <Line points={pts} color={tone} lineWidth={3} depthTest={false} renderOrder={6} />
          <Ring at={route.end} r={f.baseRadius} colour={tone} width={0.2} />
          <Tag at={route.end} y={1.2} tone={route.short ? 'info' : 'ok'}>
            {inch(route.cost)} of {inch(route.max)} · {inch(route.left)} left{route.short ? ' · stops short' : ''}
          </Tag>
        </>
      )}
      {route && !route.ok && hover && (
        <Tag at={hover} y={0.6} tone="bad">
          {route.reason ?? 'No route'}
        </Tag>
      )}
    </group>
  )
}

// ---------------------------------------------------------------- targets, doors, aim

/** A ring and the engine's odds over every fighter the pending decision offers as a target (or as a choice). */
export function TargetBadges({ state, pending }: { state: GameState; pending: PendingDecision }) {
  const hoverOption = useUi((s) => s.hoverOption)
  const items = (pending.options ?? []).flatMap((o) => {
    const id = optionFighter(o)
    const f = id ? state.fighters[id] : undefined
    return f ? [{ o, f }] : []
  })
  return (
    <group name="target-badges">
      {items.map(({ o, f }) => {
        const hot = hoverOption === o.id
        return (
          <group key={o.id}>
            <Ring at={f.pos} r={f.baseRadius + 0.3} colour={hot ? '#ffffff' : colors.accent} width={hot ? 0.2 : 0.12} />
            {(hot || pending.kind === 'shoot.target') && (
              <Tag at={f.pos} y={2.4}>
                {optionFacts(o).join(' · ') || f.name}
              </Tag>
            )}
          </group>
        )
      })}
    </group>
  )
}

/** Doors that have an action in the pending decision glow so the player knows they can be clicked. */
export function ActionableDoors({ def, pending }: { def: BoardDef; pending: PendingDecision }) {
  const hoverOption = useUi((s) => s.hoverOption)
  const hoverDoor = useUi((s) => s.hoverDoor)
  const focus = useUi((s) => s.focusDoor)
  const ids = new Set<string>()
  const hot = new Set<string>()
  for (const o of pending.options ?? []) {
    const d = optionDoor(o)
    if (!d) continue
    ids.add(d)
    if (hoverOption === o.id) hot.add(d)
  }
  if (hoverDoor && ids.has(hoverDoor)) hot.add(hoverDoor)
  if (focus) hot.add(focus)
  return (
    <group name="actionable-doors">
      {def.doors
        .filter((d) => ids.has(d.id))
        .map((d) => (
          <DoorGlow key={d.id} poly={d.poly} hot={hot.has(d.id)} />
        ))}
    </group>
  )
}

function DoorGlow({ poly, hot }: { poly: Polygon; hot: boolean }) {
  const fill = useMemo(() => flatPolygonGeometry(poly.map((p) => ({ x: p.x, z: p.z })), 0.06), [poly])
  return (
    <mesh geometry={fill} renderOrder={4}>
      <meshBasicMaterial color={hot ? '#ffffff' : colors.accent} opacity={hot ? 0.85 : 0.55} {...flat} />
    </mesh>
  )
}

/** A marker under the pointer for the continuous set-up and aim decisions (casket spot, aim point). */
export function SpotLayer({ pending }: { pending: PendingDecision }) {
  const hover = useUi((s) => s.hover)
  const note = useUi((s) => s.hoverNote)
  const region = pending.constraints?.region
  return (
    <group name="spot-layer">
      {region && <ZonePoly poly={region} colour={colors.accent} />}
      {hover && (
        <>
          <Ring at={hover} r={0.7} colour={note?.ok ? '#3fc46b' : colors.danger} width={0.16} />
          {note && (
            <Tag at={hover} y={0.9} tone={note.ok ? 'ok' : 'bad'}>
              {note.text}
            </Tag>
          )}
        </>
      )}
    </group>
  )
}

// ---------------------------------------------------------------- transient effects

/** Tracers, impact flashes and floating text from the director (S5b replaces these with the pooled vfx engine). */
export function FxLayer() {
  const list = useFx((s) => s.list)
  return (
    <group name="fx-layer">
      {list.map((fx) => {
        if (fx.kind === 'tracer') return <Line key={fx.id} points={[fx.from, fx.to]} color={fx.color} lineWidth={4} depthTest={false} renderOrder={9} />
        return (
          <Html key={fx.id} position={fx.to} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
            <div className={fx.kind === 'impact' ? 'ms-fx-impact' : 'ms-fx-text'} style={{ color: fx.color, ['--ms-fx-ms' as string]: `${fx.dur}ms` }}>
              {fx.text}
            </div>
          </Html>
        )
      })}
    </group>
  )
}

/** CSS for the effect labels (injected once by the board canvas). */
export const FX_CSS = `
@keyframes ms-fx-rise { from { transform: translateY(0); opacity: 1 } to { transform: translateY(-28px); opacity: 0 } }
.ms-fx-text, .ms-fx-impact { font: 800 14px system-ui, sans-serif; text-shadow: 0 1px 4px #000, 0 0 8px #000; white-space: nowrap; animation: ms-fx-rise var(--ms-fx-ms, 900ms) ease-out forwards; }
.ms-fx-impact { font-size: 20px; }
`
