// Terrain drawn from the same Solids the engine uses (terrainOf), so what you see is what the rules measure.
// Procedural prisms per part with trait-based colour and transparency; Vantage floors are drawn as lighter
// platform plates at their placeable heights. A single-part layout piece (rubble slab, crates) is drawn with its
// finalised GLB (terrainGlb.ts) once it has loaded, fitted to the rules footprint; the procedural prism is the fallback
// while loading or when no GLB exists. A building (more than one part) is drawn from its own rules parts instead
// (wall plating, door lintel, barred window, deck slabs, pillars), because a generic GLB's walls never line up with the
// card's wall strips. Either way the procedural prisms stay as invisible pick proxies (placement snapping, hover
// outline). Pieces fade to 35% when they sit between the camera and a selected or active operative.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { BoxGeometry, BufferGeometry, EdgesGeometry, ExtrudeGeometry, Float32BufferAttribute, LineBasicMaterial, MeshStandardMaterial, Shape, ShapeGeometry, Vector2, type Group } from 'three'
import type { MapDef } from '@/engine'
import { distToPolygon } from '@/engine/geometry'
import { terrainOf, type Solid } from '@/engine/terrain'
import { glbStats } from '../figures/glbLoader'
import { useDisplayState } from '../presentation/presentedStore'
import { useUi, type Pt } from '../ui/uiStore'
import { deckTexture, wallTexture } from './structureTexture'
import {
  FADE_OPACITY,
  fitScale,
  pieceFootprint,
  pieceMeta,
  partStyle,
  pieceOccludes,
  setOpacity,
  useTerrainGlb,
  useTerrainManifest,
  usesGlb,
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

/** UVs in inches: top faces by (x, z); side faces by (distance along the edge, height above the ground). */
function inchUv(bottom: number) {
  return {
    generateTopUV(_g: unknown, v: ArrayLike<number>, a: number, b: number, c: number): Vector2[] {
      return [a, b, c].map((i) => new Vector2(v[i * 3]!, v[i * 3 + 1]!))
    },
    generateSideWallUV(_g: unknown, v: ArrayLike<number>, a: number, b: number, c: number, d: number): Vector2[] {
      // a and d share one edge end, b and c the other; project onto the edge direction so diagonal edges don't stretch
      let ex = v[b * 3]! - v[a * 3]!
      let ey = v[b * 3 + 1]! - v[a * 3 + 1]!
      const len = Math.hypot(ex, ey)
      if (len < 1e-9) [ex, ey] = [1, 0]
      else [ex, ey] = [ex / len, ey / len]
      return [a, b, c, d].map((i) => new Vector2(v[i * 3]! * ex + v[i * 3 + 1]! * ey, v[i * 3 + 2]! + bottom))
    },
  }
}

/** The polygon extruded from `bottom` to `top`, with inch-scaled UVs. */
function slab(poly: { x: number; z: number }[], bottom: number, top: number): BufferGeometry {
  const depth = Math.max(0.05, top - bottom)
  const g = new ExtrudeGeometry(shapeOf(poly), { depth, bevelEnabled: false, UVGenerator: inchUv(bottom) })
  g.rotateX(-Math.PI / 2)
  g.translate(0, bottom, 0)
  return g
}

function prism(s: Solid): BufferGeometry {
  return slab(s.polygon, s.bottom, s.top)
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

const BAR = 0.1
const POST = 0.3
const EDGE_OPACITY = 0.45

type Tex = 'wall' | 'deck' | 'bar' | 'post' | 'threshold'
interface Bit {
  key: string
  geo: BufferGeometry
  mat: Tex
  pos?: [number, number, number]
  edges?: BufferGeometry
}

/** The visible geometry of a building, built from its rules parts only (every extent comes from the solids). */
function structureOf(solids: Solid[]): Bit[] {
  const bits: Bit[] = []
  const walls = solids.filter((s) => ['wall', 'rampart', 'door', 'window'].includes(partStyle(s)))
  const wallBit = (key: string, s: Solid, bottom: number, top: number): Bit => {
    const geo = slab(s.polygon, bottom, top)
    return { key, geo, mat: 'wall', edges: new EdgesGeometry(geo, 30) }
  }
  for (const s of solids) {
    const style = partStyle(s)
    if (style === 'wall' || style === 'rampart' || style === 'block') bits.push(wallBit(s.partId, s, s.bottom, s.top))
    else if (style === 'floor') {
      bits.push({ key: s.partId, geo: prism(s), mat: 'deck' })
      // posts under the floor wherever a corner is not held up by a wall
      for (const [i, v] of s.polygon.entries()) {
        if (s.bottom < 0.3 || walls.some((w) => distToPolygon(v, w.polygon) <= 0.6)) continue
        bits.push({ key: `${s.partId}-post${i}`, geo: new BoxGeometry(POST, s.bottom, POST), mat: 'post', pos: [v.x, s.bottom / 2, v.z] })
      }
    } else if (style === 'door') {
      // open doorway: lintel only, plus a threshold plate on the ground
      bits.push(wallBit(`${s.partId}-lintel`, s, Math.min(2, s.top - 0.1), s.top))
      const threshold = plate(s)
      threshold.translate(0, 0.01, 0)
      bits.push({ key: `${s.partId}-threshold`, geo: threshold, mat: 'threshold' })
    } else {
      bits.push(wallBit(`${s.partId}-sill`, s, s.bottom, Math.min(1, s.top - 0.1)))
      bits.push(wallBit(`${s.partId}-lintel`, s, Math.min(2, s.top - 0.1), s.top))
      // bars across the opening, spaced along the strip's long axis
      const { minX, maxX, minZ, maxZ } = s.bbox
      const alongX = maxX - minX >= maxZ - minZ
      const len = alongX ? maxX - minX : maxZ - minZ
      const n = Math.min(5, Math.max(3, Math.round(len / 1.2)))
      for (let i = 1; i <= n; i++) {
        const t = (i / (n + 1)) * len
        const x = alongX ? minX + t : (minX + maxX) / 2
        const z = alongX ? (minZ + maxZ) / 2 : minZ + t
        bits.push({ key: `${s.partId}-bar${i}`, geo: new BoxGeometry(BAR, 1, BAR), mat: 'bar', pos: [x, 1.5, z] })
      }
    }
  }
  return bits
}

/** Materials are per piece so each building fades on its own (the textures are shared). */
function structureMaterials() {
  return {
    wall: new MeshStandardMaterial({ map: wallTexture(), roughness: 0.85, metalness: 0.15 }),
    // decks share their top plane with the wall tops that cross them; pushing the deck back lets the wall win
    deck: new MeshStandardMaterial({ map: deckTexture(), roughness: 0.8, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    bar: new MeshStandardMaterial({ color: '#2b2420', roughness: 0.6, metalness: 0.4 }),
    post: new MeshStandardMaterial({ color: '#3a3d42', roughness: 0.7, metalness: 0.35 }),
    threshold: new MeshStandardMaterial({ color: '#1d1a17', roughness: 0.9, metalness: 0.1 }),
    // lines are not Meshes, so setOpacity skips them; Piece fades this one by hand
    edge: new LineBasicMaterial({ color: '#1a1511', transparent: true, opacity: EDGE_OPACITY }),
  }
}

interface Target {
  x: number
  y: number
  z: number
  feetY: number
}

const fadeState = new Map<string, number>()

/** One layout piece: its GLB (single-part pieces) or the structure drawn from its parts (buildings), plus the parts as pick proxies. */
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
  const single = useMemo(() => usesGlb(solids.map((s) => ({ footprint: s.polygon }))), [solids])
  const glb = useTerrainGlb(single ? meta?.model : undefined, single ? entry : undefined)
  const structure = useMemo(() => (single ? null : { bits: structureOf(solids), mats: structureMaterials() }), [single, solids])
  const structureRef = useRef<Group>(null)
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
    const root = glb ?? structureRef.current
    if (!root) return
    const cam = st.camera.position
    const blocked = targets.current.some((t) => pieceOccludes(cam, t, boxes))
    const goal = blocked ? FADE_OPACITY : 1
    if (cur.current === goal) return
    const next = Math.abs(goal - cur.current) < 0.02 ? goal : cur.current + (goal - cur.current) * Math.min(1, dt * 12)
    cur.current = next
    fadeState.set(featureId, next)
    setOpacity(root, next)
    if (structure) structure.mats.edge.opacity = EDGE_OPACITY * next
    invalidate()
  })
  const k = (meta?.yaw ?? 0) * (Math.PI / 180)
  return (
    <group>
      {glb && meta && fit && <primitive object={glb} position={[meta.pos.x, 0, meta.pos.z]} rotation={[0, k, 0]} scale={fit} />}
      {structure && (
        <group ref={structureRef}>
          {structure.bits.map((b) => (
            <group key={b.key} position={b.pos}>
              <mesh geometry={b.geo} material={structure.mats[b.mat]} castShadow receiveShadow />
              {b.edges && <lineSegments geometry={b.edges} material={structure.mats.edge} />}
            </group>
          ))}
        </group>
      )}
      {solids.map((s) => (
        <Part key={s.partId} solid={s} ghost={!!glb || !!structure} onPoint={onPoint} />
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
