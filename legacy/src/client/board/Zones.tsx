// Drop zones, territories, centreline and objective markers drawn from engine state and mission data.
import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { DoubleSide, Shape } from 'three'
import type { GameState, Polygon } from '@/engine'
import { markerRadius } from '@/engine/state'
import { useFx } from '../presentation/fxStore'
import { colors } from '../ui/theme'
import { isTainted } from '@/engine/teams/legionaries'
import { lookupTerm } from '../game/glossary'
import { useBoardTip } from '../ui/markerInfo'

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
  // drei's <Line> disposes its material whenever `points` changes identity; a fresh array every render recompiled
  // the dashed line shader on every presented event (the only dashed line on the board, so its program was freed)
  // (keyed by value: a snapshot may carry a copied map)
  const c = meta?.centreline
  const ck = c ? `${c.a.x},${c.a.z},${c.b.x},${c.b.z}` : ''
  const centrePts = useMemo<[number, number, number][] | null>(() => {
    if (!ck) return null
    const [ax, az, bx, bz] = ck.split(',').map(Number) as [number, number, number, number]
    return [[ax, 0.045, az], [bx, 0.045, bz]]
  }, [ck])
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
      {centrePts && (
        <Line
          points={centrePts}
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

/** A tainted objective (Legionaries, Favoured of the Dark Gods): a violet spiked crown over the marker, with a hover tooltip. */
function TaintMark({ r }: { r: number }) {
  const over = useRef(false)
  const entry = lookupTerm('Tainted objective')
  return (
    <group data-tainted>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[r * 1.02, r * 1.2, 6]} />
        <meshBasicMaterial color="#b44bff" />
      </mesh>
      <mesh position={[0, 0.62, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.16, 0.34, 5]} />
        <meshBasicMaterial color="#b44bff" />
      </mesh>
      <mesh
        position={[0, 0.3, 0]}
        onPointerOver={(e) => {
          if (e.pointerType === 'touch') return
          over.current = true
          useBoardTip.setState({ tip: { title: 'Tainted objective', body: entry?.body ?? 'Tainted by the Legionaries.', x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } })
        }}
        onPointerOut={() => {
          if (!over.current) return
          over.current = false
          useBoardTip.setState({ tip: null })
        }}
      >
        <cylinderGeometry args={[r * 1.2, r * 1.2, 0.8, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** An Aquilon Drop marker (Tempestus Aquilons Drop Insertion): the engine tags it with the equipment id `ta.drop`. */
function isDropMarker(m: { kind: string; equipmentId?: string }): boolean {
  return m.kind === 'equipment' && m.equipmentId === 'ta.drop'
}

/** The Exaction Squad Nuncio-aquila: the engine tags it with the equipment id `ex.nuncio`. */
function isNuncioMarker(m: { kind: string; equipmentId?: string }): boolean {
  return m.kind === 'equipment' && m.equipmentId === 'ex.nuncio'
}

/** A broadcast beacon: a double-headed eagle read as two crossed bars on a post, with a ring in the owner's colour. */
function NuncioMark({ r, color }: { r: number; color: string }) {
  const over = useRef(false)
  const entry = lookupTerm('Nuncio-aquila marker')
  return (
    <group data-nuncio-marker>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[r * 1.4, r * 1.6, 24]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.06, 0.9, 0.06]} />
        <meshBasicMaterial color="#e8e8f2" />
      </mesh>
      <mesh position={[0, 0.85, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.55, 0.07, 0.07]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.85, 0]} rotation={[0, 0, -Math.PI / 4]}>
        <boxGeometry args={[0.55, 0.07, 0.07]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh
        position={[0, 0.5, 0]}
        onPointerOver={(e) => {
          if (e.pointerType === 'touch') return
          over.current = true
          useBoardTip.setState({ tip: { title: 'Nuncio-aquila', body: entry?.body ?? 'The Proctor\'s broadcast marker.', x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } })
        }}
        onPointerOut={() => {
          if (!over.current) return
          over.current = false
          useBoardTip.setState({ tip: null })
        }}
      >
        <cylinderGeometry args={[r * 1.6, r * 1.6, 1.2, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** The landing anchor: a hexagonal pad in the owner's colour with a downward arrow above it, so it never reads as an objective. */
function DropMark({ r, color }: { r: number; color: string }) {
  const over = useRef(false)
  const entry = lookupTerm('Drop marker')
  return (
    <group data-drop-marker>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[r * 1.25, r * 1.5, 6]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.7, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.2, 0.42, 4]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.1, 0]}>
        <boxGeometry args={[0.07, 0.4, 0.07]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh
        position={[0, 0.5, 0]}
        onPointerOver={(e) => {
          if (e.pointerType === 'touch') return
          over.current = true
          useBoardTip.setState({ tip: { title: 'Drop marker', body: entry?.body ?? 'An Aquilon landing anchor.', x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } })
        }}
        onPointerOut={() => {
          if (!over.current) return
          over.current = false
          useBoardTip.setState({ tip: null })
        }}
      >
        <cylinderGeometry args={[r * 1.5, r * 1.5, 1.2, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
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
              {isDropMarker(m) ? (
                <DropMark r={r} color={m.owner ? SEAT[m.owner] : '#6fe0ff'} />
              ) : isNuncioMarker(m) ? (
                <NuncioMark r={r} color={m.owner ? SEAT[m.owner] : '#6fe0ff'} />
              ) : (
                <mesh position={[0, 0.25, 0]}>
                  <octahedronGeometry args={[0.22, 0]} />
                  <meshBasicMaterial color={m.kind === 'objective' ? '#ffe066' : '#6fe0ff'} />
                </mesh>
              )}
              {m.kind === 'objective' && isTainted(state, m.id) && <TaintMark r={r} />}
            </group>
          )
        })}
    </group>
  )
}
