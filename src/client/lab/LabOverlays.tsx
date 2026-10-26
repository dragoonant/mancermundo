// Translucent overlays for the lab: the two deployment zones (seat colours) and the casket / objective spots. Flat meshes just
// above the deck with polygon offset and no depth writes, so they never z-fight with the floor tiles or with each other.
import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { Polygon, Vec2 } from '@/engine/types'
import { flatPolygonGeometry } from '../board/zmGeometry'
import { SEAT_COLOR } from './LabFighter'
import type { Seat, Zones } from './placement'

const ZONE_Y = 0.035
const OBJECTIVE_Y = 0.05

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
        <meshBasicMaterial color={colour} transparent opacity={0.3} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <lineLoop geometry={edge} renderOrder={3}>
        <lineBasicMaterial color={colour} transparent opacity={0.8} depthWrite={false} />
      </lineLoop>
    </group>
  )
}

export function DeploymentZones({ zones }: { zones: Zones }) {
  return (
    <group name="deployment-zones">
      {(['A', 'B'] as Seat[]).flatMap((seat) => zones[seat].map((poly, i) => <ZonePoly key={`${seat}${i}`} poly={poly} colour={SEAT_COLOR[seat]} />))}
    </group>
  )
}

export function Objectives({ spots }: { spots: readonly Vec2[] }) {
  return (
    <group name="objectives">
      {spots.map((s, i) => (
        <group key={i} position={[s.x, OBJECTIVE_Y, s.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
            <ringGeometry args={[0.55, 0.8, 32]} />
            <meshBasicMaterial color="#f5d95a" transparent opacity={0.75} depthWrite={false} polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
            <circleGeometry args={[0.55, 32]} />
            <meshBasicMaterial color="#f5d95a" transparent opacity={0.22} depthWrite={false} polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} />
          </mesh>
          <mesh position={[0, 0.35, 0]} rotation={[0, Math.PI / 4, 0]}>
            <octahedronGeometry args={[0.2]} />
            <meshBasicMaterial color="#ffe98a" transparent opacity={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
