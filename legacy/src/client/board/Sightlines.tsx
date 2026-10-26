// 3D sight-line overlay: from the operative's position (the planned end of a staged move, else where it stands)
// a line to every VISIBLE enemy, coloured by the engine's verdict, a badge on each enemy and, with the threat view on,
// red lines from the enemies that could shoot back. Enemies the operative cannot see get no line (the panel lists them).
// Every line is a faint trace plus a train of bright pulses sweeping along it (sight lines run operative -> enemy, threat
// lines enemy -> operative). One shared LineMaterial per colour / width; one useFrame moves every pulse by changing
// `dashOffset`, and under frameloop="demand" it asks for the next frame only while lines are on screen.
// All numbers come from interaction/sightlines.ts (engine queries).
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import { Line2, LineGeometry, LineMaterial } from 'three-stdlib'
import { AdditiveBlending, Color } from 'three'
import type { SightEntry, SightStatus, ThreatEntry } from '../interaction/sightlines'
import { useSightData } from '../interaction/sightData'
import { useUi } from '../ui/uiStore'
import { BaseRing } from '../figures/OvalBase'

export const SIGHT_COLOR: Record<SightStatus, string> = {
  valid: '#6dff9a',
  cover: '#ffb347',
  obscured: '#ffb347',
  blocked: '#ffb347',
  unseen: '#8a8f9f',
}
export const THREAT_COLOR = '#ff5a4f'

export function sightLabel(e: SightEntry): string {
  const dmg = e.expected !== null ? ` · ${e.expected.toFixed(1)} dmg` : ''
  switch (e.status) {
    case 'valid':
      return `clear${dmg}`
    case 'cover':
      return `in cover${dmg}`
    case 'obscured':
      return `${e.inCover ? 'cover+obscured' : 'obscured'}${dmg}`
    case 'blocked':
      return e.reason?.startsWith('concealed') ? 'concealed: no shot' : 'no shot'
    default:
      return 'not visible'
  }
}

const lift = (v: { x: number; y: number; z: number }, dy = 0): [number, number, number] => [v.x, v.y + dy, v.z]

/** The same line shifted sideways, so the red threat line runs beside the verdict line instead of on top of it. */
function beside(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, side: number): [[number, number, number], [number, number, number]] {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = Math.hypot(dx, dz) || 1
  const ox = (-dz / len) * side
  const oz = (dx / len) * side
  return [
    [a.x + ox, a.y, a.z + oz],
    [b.x + ox, b.y, b.z + oz],
  ]
}

// ---------------------------------------------------------------- the animated line

/** Pulse train: a bright PULSE-inch segment every PERIOD inches, travelling SPEED inches per second. */
const PULSE = 0.55
const PERIOD = 2.2
const SPEED = 6.5

type V3 = [number, number, number]
const mats = new Map<string, LineMaterial>()

function material(color: string, width: number, pulse: boolean): LineMaterial {
  const key = `${color}|${width}|${pulse ? 'p' : 'b'}`
  let m = mats.get(key)
  if (!m) {
    m = new LineMaterial({
      color: new Color(color).getHex(),
      linewidth: width,
      transparent: true,
      opacity: pulse ? 1 : 0.32,
      depthWrite: false,
      dashed: pulse,
      dashSize: PULSE,
      gapSize: PERIOD - PULSE,
      ...(pulse ? { blending: AdditiveBlending } : {}),
    })
    mats.set(key, m)
  }
  return m
}

/** Does any sight line exist right now? The frame loop runs only while this is true. */
let linesShown = 0

function PulseLine({ points, color, width }: { points: [V3, V3]; color: string; width: number }): ReactElement {
  const [a, b] = points
  const geoKey = `${a.join(',')}|${b.join(',')}`
  const line = useMemo(() => {
    const g = new LineGeometry()
    g.setPositions([...a, ...b])
    const l = new Line2(g, material(color, width, true))
    l.computeLineDistances()
    l.raycast = () => undefined
    l.frustumCulled = false
    return l
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoKey, color, width])
  const base = useMemo(() => {
    const l = new Line2(line.geometry, material(color, width, false))
    l.raycast = () => undefined
    l.frustumCulled = false
    return l
  }, [line, color, width])
  useEffect(() => {
    linesShown++
    return () => {
      linesShown--
    }
  }, [])
  useEffect(() => () => line.geometry.dispose(), [line])
  return (
    <>
      <primitive object={base} />
      <primitive object={line} />
    </>
  )
}

/** Moves every pulse and keeps the demand loop alive while lines are shown. Mounted once inside the layer. */
function PulseClock(): null {
  const invalidate = useThree((s) => s.invalidate)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  useFrame((state) => {
    if (linesShown <= 0) return
    const t = performance.now() / 1000
    const offset = -((t * SPEED) % PERIOD)
    for (const m of mats.values()) {
      m.resolution.set(state.size.width, state.size.height)
      if (m.dashed) m.dashOffset = offset
    }
    // about 30 frames a second is plenty for a sweep and keeps the idle board cheap
    if (timer.current === null) {
      timer.current = setTimeout(() => {
        timer.current = null
        invalidate()
      }, 32)
    }
  })
  useEffect(() => {
    invalidate()
  })
  return null
}

export function SightlineLayer() {
  const d = useSightData()
  const hoverOp = useUi((s) => s.hoverOp)
  if (!d) return null
  const { sight, threat, threatOn } = d
  const conceal = new Map<string, ThreatEntry>((threat?.conceal.entries ?? []).map((t) => [t.id, t]))
  const engage = new Map<string, ThreatEntry>((threat?.engage.entries ?? []).map((t) => [t.id, t]))
  const ids = new Set<string>([...sight.entries.map((e) => e.id), ...engage.keys()])
  const byId = new Map(sight.entries.map((e) => [e.id, e]))
  return (
    <group>
      <PulseClock />
      {[...ids].map((id) => {
        const e = byId.get(id)
        const t = engage.get(id)
        const op = d.state.operatives[id]
        if (!op) return null
        const color = e ? SIGHT_COLOR[e.status] : THREAT_COLOR
        const hot = hoverOp === id
        const lines: ReactElement[] = []
        if (e && e.visible) {
          lines.push(<PulseLine key={`sight-${hot ? 'h' : 'n'}`} points={[lift(e.from), lift(e.to)]} color={color} width={hot ? 4 : 2.6} />)
        }
        if (threatOn && t) {
          const still = conceal.has(id)
          // red, offset to one side so it sits beside the green / amber line; runs enemy -> operative
          lines.push(<PulseLine key={`threat-${still ? 's' : 'e'}`} points={beside(t.from, t.to, 0.22)} color={THREAT_COLOR} width={still ? 3.4 : 2} />)
        }
        const tc = conceal.get(id)
        return (
          <group key={id}>
            {lines}
            <group position={[op.pos.x, op.pos.y, op.pos.z]} rotation={[0, op.facing, 0]}>
              <BaseRing baseRadius={op.baseRadius} ovalHalfAxis={op.ovalHalfAxis} inner={0.1} outer={hot ? 0.4 : 0.24} color={color} opacity={hot ? 1 : 0.75} y={0.09} />
            </group>
            <Html position={[op.pos.x, op.pos.y + op.height + 1.7, op.pos.z]} center zIndexRange={[10, 0]} distanceFactor={16} style={{ pointerEvents: 'none' }}>
              <div
                data-testid={`sight-badge-${id}`}
                data-status={e?.status ?? 'threat'}
                data-line={e && e.visible ? 'sight' : e ? 'none' : 'threat'}
                style={{ background: 'rgba(8,8,14,0.9)', font: '700 11px system-ui', padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', border: `1px solid ${color}88`, textAlign: 'center' }}
              >
                {e && <div style={{ color }}>{sightLabel(e)}</div>}
                {threatOn && t && (
                  <div data-testid={`threat-badge-${id}`} style={{ color: THREAT_COLOR }}>
                    hits you {t.expected.toFixed(1)} if Engage · {tc ? tc.expected.toFixed(1) : '0'} if Conceal
                  </div>
                )}
              </div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}
