// 3D part of the measure tool: the two picked points, the ruler line between them (base edge to base edge for
// operatives) and the distance label. Read-only; the numbers come from interaction/sightlines.ts `measure`.
import { useMemo } from 'react'
import { Html, Line } from '@react-three/drei'
import { measure, type MeasurePt } from '../interaction/sightlines'
import { useSight } from '../interaction/sightStore'
import { useDisplayState } from '../presentation/presentedStore'
import { useUi } from '../ui/uiStore'

export const MEASURE_COLOR = '#4fe3ff'

type V3 = [number, number, number]

/** The ruler line ends at the base edge of an operative, not at its centre. */
function edgePoints(a: MeasurePt, ra: number, b: MeasurePt, rb: number): [V3, V3] {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = Math.hypot(dx, dz) || 1
  const ux = dx / len
  const uz = dz / len
  const sa = Math.min(ra, len / 2)
  const sb = Math.min(rb, len / 2)
  return [
    [a.x + ux * sa, a.y + 0.2, a.z + uz * sa],
    [b.x - ux * sb, b.y + 0.2, b.z - uz * sb],
  ]
}

function Pin({ p, r }: { p: MeasurePt; r: number }) {
  return (
    <group position={[p.x, p.y + 0.1, p.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.max(0.14, r), Math.max(0.14, r) + 0.1, 32]} />
        <meshBasicMaterial color={MEASURE_COLOR} />
      </mesh>
    </group>
  )
}

export function MeasureLayer() {
  const state = useDisplayState()
  const on = useSight((s) => s.measureOn)
  const a = useSight((s) => s.mA)
  const b = useSight((s) => s.mB)
  const hover = useUi((s) => s.hover)
  const hoverOp = useUi((s) => s.hoverOp)
  const probe: MeasurePt | null = useMemo(() => {
    if (b || !a || !hover) return null
    return { x: hover.x, y: hover.y, z: hover.z, ...(hoverOp ? { opId: hoverOp } : {}) }
  }, [a, b, hover, hoverOp])
  const end = b ?? probe
  const result = useMemo(() => (state && a && end ? measure(state, a, end) : null), [state, a, end])
  if (!on || !state || !a) return null
  const ra = a.opId ? (state.operatives[a.opId]?.baseRadius ?? 0) : 0
  const rb = end?.opId ? (state.operatives[end.opId]?.baseRadius ?? 0) : 0
  const pts = end ? edgePoints(a, ra, end, rb) : null
  const mid: V3 | null = pts ? [(pts[0][0] + pts[1][0]) / 2, Math.max(pts[0][1], pts[1][1]) + 0.7, (pts[0][2] + pts[1][2]) / 2] : null
  return (
    <group>
      <Pin p={a} r={ra} />
      {b && <Pin p={b} r={rb} />}
      {pts && <Line points={pts} color={MEASURE_COLOR} lineWidth={b ? 3.2 : 2} dashed={!b} dashSize={0.3} gapSize={0.2} transparent opacity={b ? 1 : 0.7} />}
      {mid && result && (
        <Html position={mid} center zIndexRange={[10, 0]} distanceFactor={16} style={{ pointerEvents: 'none' }}>
          <div
            data-testid="measure-label"
            style={{ background: 'rgba(8,8,14,0.9)', color: MEASURE_COLOR, font: '800 13px system-ui', padding: '2px 8px', borderRadius: 5, whiteSpace: 'nowrap', border: `1px solid ${MEASURE_COLOR}99` }}
          >
            {result.inches.toFixed(1)}″
          </div>
        </Html>
      )}
    </group>
  )
}
