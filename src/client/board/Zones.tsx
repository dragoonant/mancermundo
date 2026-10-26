// Drop zones, territories, centreline and objective markers drawn from engine state and mission data.
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { DoubleSide, Shape } from 'three'
import type { GameState, Polygon } from '@/engine'
import { markerRadius } from '@/engine/state'
import { useFx } from '../presentation/fxStore'
import { colors } from '../ui/theme'

function PolyFill({ poly, color, opacity, y }: { poly: Polygon; color: string; opacity: number; y: number }) {
  const geo = useMemo(() => {
    const sh = new Shape()
    poly.forEach((p, i) => (i === 0 ? sh.moveTo(p.x, -p.z) : sh.lineTo(p.x, -p.z)))
    sh.closePath()
    return sh
  }, [poly])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} renderOrder={2}>
      <shapeGeometry args={[geo]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} side={DoubleSide} depthWrite={false} />
    </mesh>
  )
}

function PolyLine({ poly, color, y, width = 2, opacity = 0.9 }: { poly: Polygon; color: string; y: number; width?: number; opacity?: number }) {
  const pts = useMemo(() => [...poly, poly[0]!].map((p) => [p.x, y, p.z] as [number, number, number]), [poly, y])
  return <Line points={pts} color={color} lineWidth={width} transparent opacity={opacity} />
}

const SEAT = { A: colors.playerA, B: colors.playerB }

export function Zones({ state, deployRegion, hoverZone }: { state: GameState; deployRegion: Polygon | null; hoverZone: string | null }) {
  const meta = state.map.meta ?? null
  const inSetup = state.phase === 'setup'
  const owner = (zoneId: string) => (['A', 'B'] as const).find((s) => state.players[s].dropZoneId === zoneId) ?? null
  return (
    <group>
      {state.map.dropZones.map((z) => {
        const o = owner(z.id)
        const color = o ? SEAT[o] : '#ffffff'
        const strong = hoverZone === z.id
        return (
          <group key={z.id}>
            {(inSetup || strong) && <PolyFill poly={z.polygon} color={color} opacity={strong ? 0.4 : o ? 0.16 : 0.1} y={0.03} />}
            <PolyLine poly={z.polygon} color={color} y={0.035} width={inSetup ? 2.5 : 1} opacity={inSetup ? 0.9 : 0.35} />
          </group>
        )
      })}
      {deployRegion && <PolyFill poly={deployRegion} color="#6dff9a" opacity={0.22} y={0.04} />}
      {meta && inSetup && meta.territories.length >= 2 && (
        <>
          <PolyLine poly={meta.territories[0]!} color={colors.playerA} y={0.05} width={1} opacity={0.35} />
          <PolyLine poly={meta.territories[1]!} color={colors.playerB} y={0.05} width={1} opacity={0.35} />
        </>
      )}
      {meta && (
        <Line
          points={[
            [meta.centreline.a.x, 0.045, meta.centreline.a.z],
            [meta.centreline.b.x, 0.045, meta.centreline.b.z],
          ]}
          color="#cfd6e4"
          lineWidth={1}
          dashed
          dashSize={0.6}
          gapSize={0.4}
          transparent
          opacity={0.35}
        />
      )}
    </group>
  )
}

export function Markers({ state }: { state: GameState }) {
  // a control change shows at its beat, before the display state catches up
  const control = useFx((s) => s.control)
  return (
    <group>
      {state.markers
        .filter((m) => !m.hidden || m.owner === null)
        .map((m) => {
          const r = markerRadius(m)
          const controller = m.id in control ? control[m.id] : m.controller
          const color = controller ? SEAT[controller] : '#e8e8f2'
          return (
            <group key={m.id} position={[m.pos.x, 0.06, m.pos.z]} data-marker={m.id}>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[r, 28]} />
                <meshBasicMaterial color="#1b1d26" />
              </mesh>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
                <ringGeometry args={[r * 0.78, r, 28]} />
                <meshBasicMaterial color={color} />
              </mesh>
              <mesh position={[0, 0.25, 0]}>
                <octahedronGeometry args={[0.22, 0]} />
                <meshBasicMaterial color={m.kind === 'objective' ? '#ffe066' : '#6fe0ff'} />
              </mesh>
            </group>
          )
        })}
    </group>
  )
}
