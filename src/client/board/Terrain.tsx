// Terrain drawn from the same Solids the engine uses (terrainOf), so what you see is what the rules measure.
// Procedural prisms per part with trait-based colour and transparency; Vantage floors are drawn as lighter
// platform plates at their placeable heights. Each layout piece is drawn with its finalised GLB (terrainGlb.ts) once it
// has loaded, fitted to the rules footprint; the procedural prisms are the fallback while loading or when no GLB
// exists, and stay as invisible pick proxies (placement snapping, hover outline) under the GLB. Pieces fade to 35%
// when they sit between the camera and a selected or active operative.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, EdgesGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape, ShapeGeometry } from 'three'
import type { MapDef } from '@/engine'
import { terrainOf, type Solid } from '@/engine/terrain'
import { glbStats } from '../figures/glbLoader'
import { useDisplayState } from '../presentation/presentedStore'
import { useUi, type Pt } from '../ui/uiStore'
import {
  FADE_OPACITY,
  fitScale,
  pieceFootprint,
  pieceMeta,
  pieceOccludes,
  setOpacity,
  useTerrainGlb,
  useTerrainManifest,
  type Box3like,
  type TerrainEntry,
} from './terrainGlb'

interface Look {
  color: string
  opacity: number
  edge: string
}

export function lookOf(s: Pick<Solid, 'heavy' | 'light' | 'blocking' | 'vantage' | 'accessible' | 'insignificant' | 'exposed' | 'ceiling' | 'barred'>): Look {
  if (s.accessible) return { color: '#2a8f8f', opacity: 0.55, edge: '#7fe3e3' }
  if (s.barred) return { color: '#3d6a52', opacity: 0.4, edge: '#8bd0a8' }
  if (s.ceiling) return { color: '#7b8290', opacity: 0.5, edge: '#c3cad6' }
  if (s.blocking) return { color: '#30333a', opacity: 1, edge: '#7a808c' }
  if (s.vantage) return { color: '#5c6c80', opacity: 1, edge: '#b6c8de' }
  if (s.heavy) return { color: '#4c5059', opacity: 1, edge: '#9298a6' }
  if (s.exposed) return { color: '#7a5a5a', opacity: 0.85, edge: '#d29c9c' }
  if (s.insignificant) return { color: '#5a554c', opacity: 0.9, edge: '#a39b8c' }
  if (s.light) return { color: '#94724a', opacity: 0.72, edge: '#d9b17d' }
  return { color: '#555a63', opacity: 1, edge: '#9aa0ac' }
}

function shapeOf(poly: { x: number; z: number }[]): Shape {
  // shape space is XY; after rotateX(-90deg) shape +y maps to world -z, so feed y = -z
  const sh = new Shape()
  poly.forEach((p, i) => (i === 0 ? sh.moveTo(p.x, -p.z) : sh.lineTo(p.x, -p.z)))
  sh.closePath()
  return sh
}

function prism(s: Solid): BufferGeometry {
  const depth = Math.max(0.05, s.top - s.bottom)
  const g = new ExtrudeGeometry(shapeOf(s.polygon), { depth, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  g.translate(0, s.bottom, 0)
  return g
}

function plate(s: Solid): BufferGeometry {
  const g = new ShapeGeometry(shapeOf(s.polygon))
  g.rotateX(-Math.PI / 2)
  return g
}

/** Footprint outline (ground ring + top ring + corner posts) for the hover highlight. */
function outline(s: Solid): BufferGeometry {
  const pts = s.polygon
  const v: number[] = []
  const top = s.top + 0.02
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    v.push(a.x, 0.03, a.z, b.x, 0.03, b.z, a.x, top, a.z, b.x, top, b.z, a.x, 0.03, a.z, a.x, top, a.z)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(v, 3))
  return g
}

function Part({ solid, ghost, onPoint }: { solid: Solid; ghost: boolean; onPoint(p: Pt | null, click: boolean): void }) {
  const look = lookOf(solid)
  const [hovered, setHovered] = useState(false)
  const geo = useMemo(() => prism(solid), [solid])
  const edges = useMemo(() => new EdgesGeometry(geo, 30), [geo])
  const ring = useMemo(() => (hovered ? outline(solid) : null), [hovered, solid])
  const plateGeo = useMemo(() => (solid.floors.length ? plate(solid) : null), [solid])
  const pointFor = (e: ThreeEvent<PointerEvent | MouseEvent>): Pt => {
    // Landing on a top face of a part with placeable floors snaps to the nearest floor; anything else is the ground.
    const hitTop = e.point.y >= solid.top - 0.2
    if (hitTop && solid.floors.length > 0) {
      const y = solid.floors.reduce((best, f) => (Math.abs(f - e.point.y) < Math.abs(best - e.point.y) ? f : best), solid.floors[0]!)
      return { x: e.point.x, z: e.point.z, y }
    }
    return { x: e.point.x, z: e.point.z, y: 0 }
  }
  return (
    <group>
      <mesh
        geometry={geo}
        castShadow={!ghost}
        receiveShadow={!ghost}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onPointerMove={(e) => {
          e.stopPropagation()
          onPoint(pointFor(e), false)
        }}
        onClick={(e) => {
          if (e.delta > 6) return
          e.stopPropagation()
          onPoint(pointFor(e), true)
        }}
      >
        {ghost ? (
          <meshBasicMaterial visible={false} />
        ) : (
          <meshStandardMaterial color={look.color} transparent={look.opacity < 1} opacity={look.opacity} roughness={0.85} metalness={0.1} depthWrite={look.opacity >= 0.9} />
        )}
      </mesh>
      {!ghost && (
        <lineSegments geometry={edges}>
          <lineBasicMaterial color={look.edge} transparent opacity={0.7} />
        </lineSegments>
      )}
      {ring && (
        <lineSegments geometry={ring} renderOrder={5}>
          <lineBasicMaterial color={look.edge} depthTest={false} transparent opacity={0.95} />
        </lineSegments>
      )}
      {plateGeo &&
        [...new Set(solid.floors)].map((f) => (
          <mesh key={f} geometry={plateGeo} position={[0, f + 0.02, 0]}>
            <meshBasicMaterial color="#9fb6d0" transparent opacity={0.28} depthWrite={false} />
          </mesh>
        ))}
    </group>
  )
}

interface Target {
  x: number
  y: number
  z: number
  feetY: number
}

const fadeState = new Map<string, number>()

/** One layout piece: its GLB (when loaded) plus its parts. */
function Piece({
  featureId,
  solids,
  meta,
  entry,
  targets,
  onPoint,
}: {
  featureId: string
  solids: Solid[]
  meta: { model: string; pos: { x: number; z: number }; yaw: number } | null
  entry: TerrainEntry | undefined
  targets: MutableRefObject<Target[]>
  onPoint(p: Pt | null, click: boolean): void
}) {
  const glb = useTerrainGlb(meta?.model, entry)
  const invalidate = useThree((s) => s.invalidate)
  const fit = useMemo(() => {
    if (!meta || !entry) return null
    // the solids carry the layout's footprint polygons, so any layout fits (not just the three bundled ones)
    const fp = pieceFootprint({ pos: meta.pos, yaw: meta.yaw, parts: solids.map((s) => ({ footprint: s.polygon, height: s.top })) })
    return fitScale(entry, fp)
  }, [meta, entry, solids])
  const boxes = useMemo<Box3like[]>(() => solids.map((s) => ({ minX: s.bbox.minX, maxX: s.bbox.maxX, minZ: s.bbox.minZ, maxZ: s.bbox.maxZ, bottom: s.bottom, top: s.top })), [solids])
  const cur = useRef(1)
  useEffect(() => {
    fadeState.set(featureId, 1)
    return () => {
      fadeState.delete(featureId)
    }
  }, [featureId])
  useFrame((st, dt) => {
    if (!glb) return
    const cam = st.camera.position
    const blocked = targets.current.some((t) => pieceOccludes(cam, t, boxes))
    const goal = blocked ? FADE_OPACITY : 1
    if (cur.current === goal) return
    const next = Math.abs(goal - cur.current) < 0.02 ? goal : cur.current + (goal - cur.current) * Math.min(1, dt * 12)
    cur.current = next
    fadeState.set(featureId, next)
    setOpacity(glb, next)
    invalidate()
  })
  const k = (meta?.yaw ?? 0) * (Math.PI / 180)
  return (
    <group>
      {glb && meta && fit && <primitive object={glb} position={[meta.pos.x, 0, meta.pos.z]} rotation={[0, k, 0]} scale={fit} />}
      {solids.map((s) => (
        <Part key={s.partId} solid={s} ghost={!!glb} onPoint={onPoint} />
      ))}
    </group>
  )
}

export function Terrain({ map, onPoint }: { map: MapDef; onPoint(p: Pt | null, click: boolean): void }) {
  const solids = useMemo(() => terrainOf(map).solids, [map])
  const manifest = useTerrainManifest()
  const state = useDisplayState()
  const selectedOp = useUi((s) => s.selectedOp)
  const invalidate = useThree((s) => s.invalidate)
  const byFeature = useMemo(() => {
    const m = new Map<string, Solid[]>()
    for (const s of solids) m.set(s.featureId, [...(m.get(s.featureId) ?? []), s])
    return [...m]
  }, [solids])

  // Selected and active operatives are what the camera should be able to see through the terrain.
  const targets = useRef<Target[]>([])
  const ids = new Set<string>()
  if (selectedOp) ids.add(selectedOp)
  const act = state?.firefight.activation?.operativeId
  if (act) ids.add(act)
  targets.current = [...ids].flatMap((id) => {
    const o = state?.operatives[id]
    return o && o.status === 'active' ? [{ x: o.pos.x, y: o.pos.y + o.height * 0.6, z: o.pos.z, feetY: o.pos.y }] : []
  })
  const sig = targets.current.map((t) => `${t.x},${t.y},${t.z}`).join('|')
  useEffect(() => {
    invalidate()
  }, [sig, invalidate])

  useEffect(() => {
    const ms = (typeof window !== 'undefined' ? window.__ms : undefined) as unknown as Record<string, unknown> | undefined
    if (!ms) return
    ms.glbTerrainLoaded = () => glbStats('terrain/').loaded
    ms.glbTerrainStats = () => glbStats('terrain/')
    ms.terrainFade = () => Object.fromEntries(fadeState)
  }, [])

  return (
    <group>
      {byFeature.map(([fid, ss]) => {
        const meta = pieceMeta(map.id, fid)
        return <Piece key={fid} featureId={fid} solids={ss} meta={meta} entry={meta ? manifest[meta.model] : undefined} targets={targets} onPoint={onPoint} />
      })}
    </group>
  )
}
