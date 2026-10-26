// A fighter on the battle board: the lab's figure (body GLB from the manifest, else the procedural stand-in) at the engine
// position, with status cues - pinned lies face up, seriously injured lies face down (a tilt), a coloured ring under the base
// for Pinned / Seriously Injured / Broken, a green ring while Ready, a gold one while it is the active fighter - plus selection,
// hover, a wounds readout, pips and condition chips (FighterPips) and the walking tween the director drives through animStore.
// Attachment GLBs and shoot / fight cues are the lab figure's job when its manifest grows them; the props stay the same shape.
import { useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { Fighter, GameState } from '@/engine'
import type { BodyManifest } from './bodyManifest'
import type { HoldClass } from './Procedural'
import { FighterBody, SEAT_COLOR } from '../lab/LabFighter'
import { baseRadiusOf, heightOf, type PlacedFighter } from '../lab/placement'
import { animPosition } from '../presentation/animStore'
import { colors } from '../ui/theme'
import { FighterPips } from './FighterPips'

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * The manifest body for a fighter: the manifest keys bodies by house, type and loadout (`goliath-forge-tyrant-chainaxe`), the data
 * names only the type's archetype, so the match is by `<house>-<type name>` and then by the weapons the fighter carries. A
 * `-b` twin is a variant picked by the fighter's id. Null when the manifest has nothing for the type (the stand-in is drawn).
 * S5b's figures/manifest.ts replaces this with the real archetype-and-loadout resolution.
 */
export function matchBody(manifest: BodyManifest, houseId: string, typeName: string, weaponNames: readonly string[], fighterId: string): string | null {
  const prefix = `${houseId}-${slug(typeName)}`
  const wantsSpecialist = /specialist/.test(prefix)
  const keys = Object.keys(manifest).filter((k) => (k === prefix || k.startsWith(`${prefix}-`)) && !k.endsWith('-b') && (wantsSpecialist || !k.slice(prefix.length).includes('specialist')))
  if (keys.length === 0) return null
  const ws = weaponNames.map(slug)
  let best = keys[0]!
  let bestScore = -1
  for (const k of keys) {
    const score = ws.filter((w) => w && k.slice(prefix.length).includes(w)).length
    if (score > bestScore) {
      best = k
      bestScore = score
    }
  }
  const twin = `${best}-b`
  let h = 0
  for (let i = 0; i < fighterId.length; i++) h = (h * 31 + fighterId.charCodeAt(i)) >>> 0
  return manifest[twin] && h % 2 === 1 ? twin : best
}

/** Static look of a fighter from the state's data snapshot (house, archetype, hold classes); position and facing come live. */
export function placedFromState(state: GameState, f: Fighter, manifest: BodyManifest = {}): PlacedFighter {
  const type = state.data.fighterTypes[f.typeId]
  let ranged: HoldClass | null = null
  let melee: HoldClass | null = null
  let rank = -1
  const RANK: Record<string, number> = { heavy: 4, special: 3, basic: 2, pistol: 1 }
  for (const w of f.weapons) {
    const def = state.data.weapons[w.weaponId]
    if (!def) continue
    if (def.class === 'close') melee ??= def.flavour === 'crush' || def.flavour === 'maul' ? 'melee2h' : 'melee1h'
    else if (def.class !== 'grenade' && (RANK[def.class] ?? 0) > rank) {
      rank = RANK[def.class] ?? 0
      ranged = def.class === 'pistol' ? 'pistol' : def.class === 'heavy' ? 'heavy' : 'rifle'
    }
  }
  return {
    id: f.id,
    seat: f.seat,
    house: type?.houseId ?? 'unknown',
    name: f.name,
    typeId: f.typeId,
    role: f.role,
    archetype: matchBody(manifest, type?.houseId ?? '', type?.name ?? f.name, f.weapons.map((w) => state.data.weapons[w.weaponId]?.name ?? w.weaponId), f.id) ?? type?.figureArchetype ?? `${type?.houseId ?? 'x'}-ganger`,
    pos: { x: f.pos.x, z: f.pos.z },
    facing: f.facing,
    baseRadius: f.baseRadius || baseRadiusOf(undefined),
    height: heightOf(f.role),
    ranged,
    melee,
  }
}

export interface BattleFighterProps {
  f: Fighter
  placed: PlacedFighter
  /** wounds to show (the director's beat override), else the state's */
  wounds?: number
  selected: boolean
  hovered: boolean
  /** a decision is waiting on this fighter (activation choice, target, assist) */
  choosable: boolean
  /** the fighter currently activating */
  active: boolean
  /** show the Ready ring (Action phase, not yet activated) */
  showReady: boolean
  onSelect(id: string): void
  onHover(id: string | null): void
}

const RING_Y = 0.05
const TILT: Record<string, number> = { pinned: -Math.PI / 2, seriouslyInjured: Math.PI / 2 }

function FloorRing({ r, colour, width = 0.12, opacity = 0.95 }: { r: number; colour: string; width?: number; opacity?: number }) {
  return (
    <mesh position={[0, RING_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
      <ringGeometry args={[r, r + width, 36]} />
      <meshBasicMaterial color={colour} transparent opacity={opacity} depthWrite={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
    </mesh>
  )
}

export function BattleFighter({ f, placed, wounds, selected, hovered, choosable, active, showReady, onSelect, onHover }: BattleFighterProps) {
  const outer = useRef<Group>(null)
  const R = f.baseRadius
  const tilt = TILT[f.posture] ?? 0
  const broken = !!f.conditions.broken
  const seatColor = SEAT_COLOR[f.seat]
  const shown = wounds ?? f.wounds
  const hurt = shown < f.maxWounds || f.fleshWounds > 0
  const body = useMemo(() => ({ ...placed, pos: { x: 0, z: 0 }, facing: 0 }), [placed])

  useFrame((s) => {
    const g = outer.current
    if (!g) return
    const a = animPosition(f.id)
    if (a) {
      g.position.set(a.x, 0, a.z)
      g.rotation.y = a.heading
      s.invalidate()
    } else {
      g.position.set(f.pos.x, 0, f.pos.z)
      g.rotation.y = f.facing
    }
  })

  const statusColour = f.posture === 'pinned' ? '#f5d95a' : f.posture === 'seriouslyInjured' ? '#ff4a3f' : broken ? '#b46bff' : null
  return (
    <group ref={outer} position={[f.pos.x, 0, f.pos.z]} rotation={[0, f.facing, 0]} name={`fighter-${f.id}`}>
      <group rotation={[tilt, 0, 0]} position={[0, tilt === 0 ? 0 : 0.3, 0]}>
        <FighterBody f={body} />
      </group>
      {/* facing wedge in front of the base (standing fighters only: a prone one has no vision arc) */}
      {f.posture === 'standing' && (
        <mesh position={[0, 0.06, R + 0.38]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.22]}>
          <coneGeometry args={[R * 0.5, 0.7, 3]} />
          <meshBasicMaterial color={seatColor} />
        </mesh>
      )}
      <FloorRing r={R * 1.0} colour={seatColor} width={0.1} opacity={0.9} />
      {statusColour && <FloorRing r={R * 1.18} colour={statusColour} width={0.14} />}
      {showReady && f.ready && !active && <FloorRing r={R * 1.45} colour="#3fc46b" width={0.07} opacity={0.8} />}
      {active && <FloorRing r={R * 1.35} colour={colors.accent} width={0.16} />}
      {choosable && <FloorRing r={R * 1.6} colour="#ffffff" width={0.09} opacity={hovered ? 1 : 0.7} />}
      {(selected || hovered) && <FloorRing r={R * 1.75} colour="#ffffff" width={0.06} opacity={selected ? 0.95 : 0.55} />}
      {/* a generous invisible pick target so a click does not need to hit the thin body */}
      <mesh
        position={[0, 1, 0]}
        visible={false}
        onClick={(e) => {
          if (e.delta > 6) return
          e.stopPropagation()
          onSelect(f.id)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          onHover(f.id)
        }}
        onPointerOut={() => onHover(null)}
      >
        <cylinderGeometry args={[R * 1.3, R * 1.3, 2.2, 10]} />
        <meshBasicMaterial />
      </mesh>
      <FighterPips f={f} y={tilt === 0 ? placed.height + 0.2 : 1.1} ready={showReady} wounds={shown} />
      {(hurt || selected || hovered || active || statusColour) && (
        <Html position={[0, placed.height + 0.55, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div
            data-testid={`fighter-tag-${f.id}`}
            style={{ display: 'flex', gap: 3, alignItems: 'center', background: 'rgba(14,15,22,0.85)', border: `1px solid ${seatColor}`, borderRadius: 5, padding: '1px 5px', font: '700 11px system-ui, sans-serif', color: colors.text, whiteSpace: 'nowrap' }}
          >
            {selected || hovered || active ? <span>{f.name}</span> : null}
            <span style={{ color: shown < f.maxWounds ? '#ffb199' : colors.muted }}>
              {shown}/{f.maxWounds}
            </span>
            {f.fleshWounds > 0 && <span style={{ color: '#ff8a7a' }}>FW{f.fleshWounds}</span>}
            {statusColour && <span style={{ color: statusColour, textTransform: 'uppercase' }}>{f.posture === 'pinned' ? 'pinned' : f.posture === 'seriouslyInjured' ? 'down' : 'broken'}</span>}
          </div>
        </Html>
      )}
    </group>
  )
}
