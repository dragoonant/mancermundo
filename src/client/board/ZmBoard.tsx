// Draws a compiled Zone Mortalis `BoardDef` (src/engine/board.ts) in 3D, entirely procedural: textured deck tiles, the wall
// rectangles as one merged bulkhead mesh (dark gunmetal, hazard foot band, light top lip), sliding bulkhead doors coloured by
// state, terminals, duct grilles, obstacles (barricades, crates, barrels) and decoration props. Everything is read from the
// `BoardDef`; nothing is drawn outside its outline. Origin at the board centre, y up, 1 unit = 1 inch.
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, RepeatWrapping, type Group, type Texture } from 'three'
import type { DoorRecord, DoorStates } from '@/engine/board'
import type { BoardDef, Vec2 } from '@/engine/types'
import { floorTexture, hazardStripeTexture, type FloorStyle } from './floorTexture'
import { wallTexture } from './wallTexture'
import { DOOR_COLORS, WALL_HEIGHT, buildWallGeometry, doorFrame, doorLook, polygonBox } from './zmGeometry'

export { DOOR_COLORS, doorLook }

/** small deterministic hash of a string into [0, 1) */
function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10007) / 10007
}

const DECK_HEIGHT = 0

function Floor({ def }: { def: BoardDef }) {
  const textures = useMemo(() => {
    const m = new Map<string, Texture>()
    for (const t of def.tiles) if (!m.has(t.floor)) m.set(t.floor, floorTexture(t.floor as FloorStyle))
    return m
  }, [def])
  return (
    <group>
      {def.tiles.map((t) => (
        <mesh key={t.id} position={[t.centre.x, DECK_HEIGHT, t.centre.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[12, 12]} />
          <meshStandardMaterial map={textures.get(t.floor)} roughness={0.78} metalness={0.35} />
        </mesh>
      ))}
    </group>
  )
}

function Walls({ def }: { def: BoardDef }) {
  const geo = useMemo(() => buildWallGeometry(def), [def])
  const tex = useMemo(() => wallTexture(), [])
  useEffect(() => () => {
    geo.sides.dispose()
    geo.caps.dispose()
  }, [geo])
  return (
    <group>
      {/* vertical faces: one mesh, one material */}
      <mesh geometry={geo.sides} castShadow receiveShadow name="walls-sides">
        <meshStandardMaterial map={tex} roughness={0.62} metalness={0.55} />
      </mesh>
      {/* top faces: lighter steel lip with a faint glow so the silhouette of every wall reads from above */}
      <mesh geometry={geo.caps} receiveShadow name="walls-caps">
        <meshStandardMaterial color="#8b94a3" roughness={0.45} metalness={0.7} emissive="#39414d" emissiveIntensity={0.55} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------------------------------------------------

const PANEL_H = WALL_HEIGHT - 0.22
const SUNK_TOP = 0.1

function Door({ door, rec, onClick }: { door: BoardDef['doors'][number]; rec: DoorRecord | undefined; onClick?: (id: string) => void }) {
  const f = useMemo(() => doorFrame(door), [door])
  const look = doorLook(rec)
  const colour = DOOR_COLORS[look]
  const stripes = useMemo(() => {
    const t = hazardStripeTexture().clone()
    t.needsUpdate = true
    return t
  }, [])
  const panel = useRef<Group>(null)
  const sunk = useRef(look === 'open' || look === 'destroyed' ? 1 : 0)
  const target = look === 'open' || look === 'destroyed' ? 1 : 0
  useFrame((state, dt) => {
    const g = panel.current
    if (!g) return
    const d = target - sunk.current
    if (Math.abs(d) > 0.001) {
      sunk.current += Math.sign(d) * Math.min(Math.abs(d), dt * 2.8)
      state.invalidate()
    }
    g.position.y = -sunk.current * (PANEL_H - SUNK_TOP)
  })
  const t = Math.max(f.thickness, 0.5)
  const accent = new Color(colour)
  return (
    <group
      position={[f.centre.x, 0, f.centre.z]}
      rotation={[0, f.yaw, 0]}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation()
              onClick(door.id)
            }
          : undefined
      }
    >
      {/* frame: two posts and a lintel with a status lamp */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (f.length / 2 + 0.02), (WALL_HEIGHT + 0.06) / 2, 0]} castShadow>
          <boxGeometry args={[0.34, WALL_HEIGHT + 0.06, t + 0.22]} />
          <meshStandardMaterial color="#2c3036" roughness={0.5} metalness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, WALL_HEIGHT - 0.1, 0]} castShadow>
        <boxGeometry args={[f.length + 0.2, 0.22, t + 0.18]} />
        <meshStandardMaterial color="#2c3036" roughness={0.5} metalness={0.7} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={`l${s}`} position={[0, WALL_HEIGHT - 0.1, s * (t / 2 + 0.1)]}>
          <boxGeometry args={[Math.min(0.9, f.length * 0.5), 0.1, 0.05]} />
          <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={1.4} />
        </mesh>
      ))}
      {/* the sliding panel */}
      <group ref={panel}>
        <mesh position={[0, PANEL_H / 2, 0]} castShadow receiveShadow name={`door-${door.id}`}>
          <boxGeometry args={[Math.max(0.2, f.length - 0.04), PANEL_H, 0.36]} />
          <meshStandardMaterial map={stripes} color={colour} emissive={accent} emissiveIntensity={0.18} roughness={0.55} metalness={0.5} />
        </mesh>
        {/* centre seam and a pull bar on each face so the panel reads as two bulkhead leaves */}
        <mesh position={[0, PANEL_H / 2, 0]}>
          <boxGeometry args={[0.06, PANEL_H * 0.98, 0.4]} />
          <meshStandardMaterial color="#17181b" roughness={0.6} metalness={0.6} />
        </mesh>
        {[1, -1].map((s) => (
          <mesh key={`r${s}`} position={[0, PANEL_H * 0.5, s * 0.2]}>
            <boxGeometry args={[0.5, 0.1, 0.05]} />
            <meshStandardMaterial color="#c8ced8" roughness={0.4} metalness={0.8} />
          </mesh>
        ))}
      </group>
      {/* doorway glow while open */}
      {look === 'open' && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[Math.max(0.2, f.length), t]} />
          <meshBasicMaterial color={DOOR_COLORS.open} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}
      {/* wreck of a destroyed door */}
      {look === 'destroyed' && (
        <group>
          {[-0.32, 0, 0.3].map((x, i) => (
            <mesh key={i} position={[x * f.length, 0.18 + i * 0.05, (i - 1) * 0.12]} rotation={[0.2 * (i - 1), 0.4 * i, 0.5 - i * 0.4]} castShadow>
              <boxGeometry args={[f.length * 0.34, 0.12, 0.5]} />
              <meshStandardMaterial color="#2a2623" emissive="#b4531c" emissiveIntensity={0.25} roughness={0.8} metalness={0.4} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  )
}

function Terminal({ pos, door, rec }: { pos: Vec2; door: BoardDef['doors'][number]; rec: DoorRecord | undefined }) {
  const c = doorFrame(door).centre
  const yaw = Math.atan2(c.x - pos.x, c.z - pos.z)
  const colour = DOOR_COLORS[doorLook(rec)]
  return (
    <group position={[pos.x, 0, pos.z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.62, 1.0, 0.4]} />
        <meshStandardMaterial color="#30353c" roughness={0.5} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.72, 0.205]}>
        <boxGeometry args={[0.46, 0.34, 0.02]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={1.3} />
      </mesh>
      <mesh position={[0, 0.38, 0.205]}>
        <boxGeometry args={[0.46, 0.12, 0.02]} />
        <meshStandardMaterial color="#14161a" />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Ducts, obstacles, props
// ---------------------------------------------------------------------------------------------------------------------

function Duct({ a, b }: BoardDef['ducts'][number]) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = Math.hypot(dx, dz)
  const yaw = Math.atan2(-dz, dx)
  return (
    <group>
      {[a, b].map((p, i) => (
        <group key={i} position={[p.x, 0.04, p.z]}>
          <mesh receiveShadow>
            <boxGeometry args={[1.5, 0.08, 1.5]} />
            <meshStandardMaterial color="#202328" roughness={0.6} metalness={0.7} />
          </mesh>
          {[-0.5, -0.25, 0, 0.25, 0.5].map((z) => (
            <mesh key={z} position={[0, 0.07, z]}>
              <boxGeometry args={[1.3, 0.05, 0.1]} />
              <meshStandardMaterial color="#6c7480" roughness={0.45} metalness={0.8} />
            </mesh>
          ))}
        </group>
      ))}
      {len > 0.1 && (
        <mesh position={[(a.x + b.x) / 2, 0.025, (a.z + b.z) / 2]} rotation={[0, yaw, 0]}>
          <boxGeometry args={[len, 0.02, 0.22]} />
          <meshBasicMaterial color="#3fb6c9" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

const CRATE_COLORS = ['#6b5a3c', '#5a4a30', '#4d5a44', '#6a4a36']
const BARREL_COLORS = ['#8a4a2a', '#5b6b52', '#a1822c', '#6b3a2e', '#4a5a66']

function Obstacle({ o }: { o: BoardDef['obstacles'][number] }) {
  const b = polygonBox(o.poly)
  const stripes = useMemo(() => {
    const t = hazardStripeTexture().clone()
    t.wrapS = t.wrapT = RepeatWrapping
    t.repeat.set(Math.max(1, Math.round(Math.max(b.w, b.d) / 0.7)), 1)
    t.needsUpdate = true
    return t
  }, [b.w, b.d])
  if (o.kind === 'barricade') {
    return (
      <group position={[b.cx, 0, b.cz]}>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[b.w, 1.0, b.d]} />
          <meshStandardMaterial color="#4b5058" roughness={0.6} metalness={0.6} />
        </mesh>
        <mesh position={[0, 0.34, 0]}>
          <boxGeometry args={[b.w + 0.02, 0.26, b.d + 0.02]} />
          <meshStandardMaterial map={stripes} color="#d9a52e" roughness={0.65} metalness={0.4} />
        </mesh>
        <mesh position={[0, 1.04, 0]} castShadow>
          <boxGeometry args={[b.w + 0.08, 0.1, b.d + 0.08]} />
          <meshStandardMaterial color="#8a93a0" roughness={0.45} metalness={0.7} emissive="#2d343e" emissiveIntensity={0.4} />
        </mesh>
      </group>
    )
  }
  if (o.kind === 'crates') {
    const nx = Math.max(1, Math.floor(b.w + 0.25))
    const nz = Math.max(1, Math.floor(b.d + 0.25))
    const cw = b.w / nx
    const cd = b.d / nz
    const items: { x: number; z: number; h: number; c: string; top: boolean }[] = []
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const k = `${o.id}.${i}.${j}`
        items.push({
          x: b.minX + cw * (i + 0.5),
          z: b.minZ + cd * (j + 0.5),
          h: 0.85 + hash01(k) * 0.35,
          c: CRATE_COLORS[Math.floor(hash01(k, 7) * CRATE_COLORS.length)]!,
          top: hash01(k, 3) > 0.62,
        })
      }
    }
    return (
      <group>
        {items.map((it, n) => (
          <group key={n} position={[it.x, 0, it.z]}>
            <mesh position={[0, it.h / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[cw * 0.94, it.h, cd * 0.94]} />
              <meshStandardMaterial color={it.c} roughness={0.8} metalness={0.2} />
            </mesh>
            <mesh position={[0, it.h / 2, 0]}>
              <boxGeometry args={[cw * 0.96, 0.1, cd * 0.96]} />
              <meshStandardMaterial color="#2a2d32" roughness={0.6} metalness={0.5} />
            </mesh>
            {it.top && (
              <mesh position={[0, it.h + 0.3, 0]} castShadow>
                <boxGeometry args={[cw * 0.66, 0.6, cd * 0.66]} />
                <meshStandardMaterial color={CRATE_COLORS[(n + 1) % CRATE_COLORS.length]} roughness={0.8} metalness={0.2} />
              </mesh>
            )}
          </group>
        ))}
      </group>
    )
  }
  if (o.kind === 'barrels') {
    const nx = Math.max(1, Math.round(b.w))
    const nz = Math.max(1, Math.round(b.d))
    const cw = b.w / nx
    const cd = b.d / nz
    const r = Math.min(cw, cd) * 0.46
    const items: { x: number; z: number; c: string }[] = []
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const k = `${o.id}.${i}.${j}`
        items.push({ x: b.minX + cw * (i + 0.5), z: b.minZ + cd * (j + 0.5), c: BARREL_COLORS[Math.floor(hash01(k) * BARREL_COLORS.length)]! })
      }
    }
    return (
      <group>
        {items.map((it, n) => (
          <group key={n} position={[it.x, 0, it.z]}>
            <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[r, r, 1.24, 16]} />
              <meshStandardMaterial color={it.c} roughness={0.55} metalness={0.55} />
            </mesh>
            {[0.22, 0.62, 1.02].map((y) => (
              <mesh key={y} position={[0, y, 0]}>
                <cylinderGeometry args={[r * 1.04, r * 1.04, 0.07, 16]} />
                <meshStandardMaterial color="#25272b" roughness={0.5} metalness={0.7} />
              </mesh>
            ))}
            <mesh position={[0, 1.25, 0]}>
              <cylinderGeometry args={[r * 0.86, r * 0.86, 0.04, 16]} />
              <meshStandardMaterial color="#17181b" roughness={0.6} metalness={0.5} />
            </mesh>
          </group>
        ))}
      </group>
    )
  }
  // unknown obstacle kind: a plain block so nothing is invisible
  return (
    <mesh position={[b.cx, 0.5, b.cz]} castShadow receiveShadow>
      <boxGeometry args={[b.w, 1, b.d]} />
      <meshStandardMaterial color="#59606a" roughness={0.7} metalness={0.4} />
    </mesh>
  )
}

function Prop({ p }: { p: BoardDef['props'][number] }) {
  const mat = (c: string, extra: object = {}) => <meshStandardMaterial color={c} roughness={0.55} metalness={0.6} {...extra} />
  let body: ReactNode
  switch (p.model) {
    case 'spill':
      body = (
        <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.15, 24]} />
          <meshStandardMaterial color="#0e1410" roughness={0.12} metalness={0.8} transparent opacity={0.85} polygonOffset polygonOffsetFactor={-1} />
        </mesh>
      )
      break
    case 'vent':
      body = (
        <group>
          <mesh position={[0, 0.03, 0]}>
            <boxGeometry args={[1.3, 0.06, 1.3]} />
            {mat('#1b1d21')}
          </mesh>
          {[-0.45, -0.15, 0.15, 0.45].map((z) => (
            <mesh key={z} position={[0, 0.07, z]}>
              <boxGeometry args={[1.15, 0.05, 0.1]} />
              {mat('#6a727e')}
            </mesh>
          ))}
        </group>
      )
      break
    case 'lamp':
      body = (
        <group>
          <mesh position={[0, 1.3, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.08, 2.6, 8]} />
            {mat('#2e3238')}
          </mesh>
          <mesh position={[0, 2.62, 0]}>
            <boxGeometry args={[0.5, 0.2, 0.3]} />
            <meshStandardMaterial color="#ffd89a" emissive="#ffb55a" emissiveIntensity={2.2} />
          </mesh>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.28, 0.32, 0.12, 12]} />
            {mat('#25282d')}
          </mesh>
        </group>
      )
      break
    case 'console':
      body = (
        <group>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[1.1, 0.9, 0.55]} />
            {mat('#2f343b')}
          </mesh>
          <mesh position={[0, 0.78, 0.2]} rotation={[-0.5, 0, 0]}>
            <boxGeometry args={[0.9, 0.4, 0.04]} />
            <meshStandardMaterial color="#58d0a0" emissive="#2fae7e" emissiveIntensity={1.4} />
          </mesh>
        </group>
      )
      break
    case 'crane':
      body = (
        <group>
          {[-1.4, 1.4].map((x) => (
            <mesh key={x} position={[x, 1.2, 0]} castShadow>
              <boxGeometry args={[0.22, 2.4, 0.22]} />
              {mat('#9a7a2a')}
            </mesh>
          ))}
          <mesh position={[0, 2.4, 0]} castShadow>
            <boxGeometry args={[3.4, 0.24, 0.3]} />
            {mat('#9a7a2a')}
          </mesh>
          <mesh position={[0.5, 1.8, 0]}>
            <boxGeometry args={[0.03, 1.2, 0.03]} />
            {mat('#15171a')}
          </mesh>
          <mesh position={[0.5, 1.15, 0]} castShadow>
            <boxGeometry args={[0.3, 0.2, 0.3]} />
            {mat('#c9962f')}
          </mesh>
        </group>
      )
      break
    case 'pipes':
      body = (
        <group>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0, 0.2 + (i === 2 ? 0.32 : 0), (i === 2 ? 0 : i * 0.42 - 0.21)]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.18, 0.18, 3.2, 12]} />
              {mat(i === 1 ? '#7a4a30' : '#4d5660')}
            </mesh>
          ))}
        </group>
      )
      break
    case 'cables':
      body = (
        <group>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[(i - 1) * 0.5, 0.05, (i - 1) * 0.18]} rotation={[0, 0.25 * (i - 1), 0]}>
              <boxGeometry args={[2.6, 0.08, 0.1]} />
              <meshStandardMaterial color="#0d0e10" roughness={0.9} />
            </mesh>
          ))}
        </group>
      )
      break
    default:
      body = (
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[0.6, 0.6, 0.6]} />
          {mat('#59606a')}
        </mesh>
      )
  }
  return (
    <group position={[p.pos.x, 0, p.pos.z]} rotation={[0, p.yaw, 0]}>
      {body}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------------------

export interface ZmBoardProps {
  def: BoardDef
  doors: DoorStates
  /** click on a door panel (the lab cycles its state) */
  onDoorClick?: (doorId: string) => void
}

export function ZmBoard({ def, doors, onDoorClick }: ZmBoardProps) {
  return (
    <group name={`board-${def.id}`}>
      <Floor def={def} />
      <Walls def={def} />
      {def.doors.map((d) => (
        <Door key={d.id} door={d} rec={doors[d.id]} onClick={onDoorClick} />
      ))}
      {def.doors.flatMap((d) => d.terminals.map((t) => <Terminal key={`${d.id}.${t.id}`} pos={t.pos} door={d} rec={doors[d.id]} />))}
      {def.ducts.map((u) => (
        <Duct key={u.id} {...u} />
      ))}
      {def.obstacles.map((o) => (
        <Obstacle key={o.id} o={o} />
      ))}
      {def.props.map((p, i) => (
        <Prop key={i} p={p} />
      ))}
    </group>
  )
}
