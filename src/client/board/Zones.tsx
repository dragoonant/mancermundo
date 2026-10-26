// Board markers drawn from engine state: caskets (a gold disc while closed, green once opened, blue for an ammo cache, grey when
// spent; hidden while a fighter carries it), smoke clouds at their radius, and the Blast circle / flamer Template the director
// has just played. Flat and unlit so they read from any camera angle; deployment regions are the DeployLayer's.
import { useMemo } from 'react'
import { DoubleSide, Shape } from 'three'
import type { GameState, Vec2 } from '@/engine'
import { useMarks } from '../presentation/markStore'

const Y = 0.05

const CASKET_COLOUR: Record<string, string> = { closed: '#e0b44a', opened: '#8be28b', ammoCache: '#7fc8ff', exhausted: '#6a6f80' }

function Disc({ at, r, colour, opacity, ring = 0.12, y = Y, order = 3 }: { at: Vec2; r: number; colour: string; opacity: number; ring?: number; y?: number; order?: number }) {
  return (
    <group position={[at.x, y, at.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={order}>
      <mesh>
        <circleGeometry args={[r, 40]} />
        <meshBasicMaterial color={colour} transparent opacity={opacity} depthWrite={false} side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <ringGeometry args={[Math.max(0.01, r - ring), r, 40]} />
        <meshBasicMaterial color={colour} transparent opacity={Math.min(1, opacity + 0.5)} depthWrite={false} side={DoubleSide} />
      </mesh>
    </group>
  )
}

function Template({ polygon }: { polygon: Vec2[] }) {
  const shape = useMemo(() => {
    const sh = new Shape()
    polygon.forEach((p, i) => (i === 0 ? sh.moveTo(p.x, -p.z) : sh.lineTo(p.x, -p.z)))
    sh.closePath()
    return sh
  }, [polygon])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, Y + 0.01, 0]} renderOrder={3}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color="#ff8a2a" transparent opacity={0.35} depthWrite={false} side={DoubleSide} />
    </mesh>
  )
}

export function Zones({ state }: { state: GameState }) {
  const marks = useMarks((s) => s.list)
  const caskets = Object.entries(state.board.caskets).filter(([, c]) => c.state !== 'removed' && !c.carriedBy)
  return (
    <group name="zones-layer">
      {caskets.map(([id, c]) => (
        <Disc key={id} at={c.pos} r={0.55} colour={CASKET_COLOUR[c.state] ?? '#e0b44a'} opacity={0.55} />
      ))}
      {state.board.smoke.map((s) => (
        <Disc key={s.id} at={s.pos} r={s.radius} colour="#b8bcc8" opacity={0.28} ring={0.08} y={Y - 0.005} order={2} />
      ))}
      {marks.map((m) => (m.kind === 'blast' ? <Disc key={m.id} at={m.centre} r={m.radius} colour="#ff6a4f" opacity={0.22} ring={0.1} y={Y + 0.005} order={4} /> : <Template key={m.id} polygon={m.polygon} />))}
    </group>
  )
}
