// Lab placement: deployment zones of a board for a scenario's deployment rule, and a simple deterministic spread of a starter
// gang over its zone. Pure (no three, no DOM): the real deployment decisions belong to the engine (setup.ts); this only has to
// put two gangs at plausible start points so the lab has figures to look at.
import { baseInRegion, deploymentRegions, freeSpaceTest, type DeploymentRegions, type DoorStates } from '@/engine/board'
import type { BoardDef, Polygon, Vec2 } from '@/engine/types'
import type { DataBundle, FighterTypeData, Id, StarterGangData, WeaponData } from '@/data/types'
import type { HoldClass } from '../figures/Procedural'
import { polygonBox } from '../board/zmGeometry'

export type Seat = 'A' | 'B'

export interface Zones {
  A: Polygon[]
  B: Polygon[]
}

export interface DeploymentRule {
  kind: 'standard' | 'tile'
  minFromCentreline?: number
  withinOfEdge?: number
}

/** The two deployment zones of a board: seat A takes the low-z half (or the first outer tile), seat B the opposite one. */
export function zonesFor(def: BoardDef, rule: DeploymentRule): Zones {
  const regions: DeploymentRegions = deploymentRegions(def, rule)
  if (regions.kind === 'standard') return { A: regions.low, B: regions.high }
  const ids = Object.keys(regions.tiles)
  const tileOf = (id: string) => def.tiles.find((t) => t.id === id)!
  ids.sort((p, q) => {
    const a = tileOf(p).centre
    const b = tileOf(q).centre
    return a.z - b.z || a.x - b.x
  })
  const first = ids[0]
  const last = ids[ids.length - 1]
  return { A: first ? regions.tiles[first]! : [], B: last && last !== first ? regions.tiles[last]! : [] }
}

export function zoneCentre(region: readonly Polygon[]): Vec2 {
  if (region.length === 0) return { x: 0, z: 0 }
  const boxes = region.map(polygonBox)
  return { x: boxes.reduce((n, b) => n + b.cx, 0) / boxes.length, z: boxes.reduce((n, b) => n + b.cz, 0) / boxes.length }
}

/**
 * `count` base positions inside a zone, spread over it: a lattice (staggered every other column) filtered to free space, then
 * every k-th point in x/z order. Falls back to a tighter lattice when the zone is small. Deterministic.
 */
export function spreadInZone(def: BoardDef, doors: DoorStates, region: readonly Polygon[], r: number, count: number): Vec2[] {
  if (region.length === 0 || count <= 0) return []
  const free = freeSpaceTest(def, doors, r)
  const boxes = region.map(polygonBox)
  const minX = Math.min(...boxes.map((b) => b.minX))
  const maxX = Math.max(...boxes.map((b) => b.maxX))
  const minZ = Math.min(...boxes.map((b) => b.minZ))
  const maxZ = Math.max(...boxes.map((b) => b.maxZ))
  let best: Vec2[] = []
  const tight = 2 * r + 0.08 // bases never overlap, whatever the zone
  for (const step of [2.6, 2.2, 1.8, 1.5, 1.35, tight].filter((v, i, all) => v >= tight && all.indexOf(v) === i)) {
    const pts: Vec2[] = []
    let col = 0
    for (let x = minX + r; x <= maxX - r + 1e-6; x += step, col++) {
      const stagger = col % 2 === 0 ? 0 : step / 2
      for (let z = minZ + r + stagger; z <= maxZ - r + 1e-6; z += step) {
        const c = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 }
        if (baseInRegion(region, c, r) && free(c)) pts.push(c)
      }
    }
    best = pts
    if (pts.length >= count) break
  }
  if (best.length <= count) return best
  const out: Vec2[] = []
  for (let i = 0; i < count; i++) out.push(best[Math.floor(((i + 0.5) * best.length) / count)]!)
  return out
}

/** Bearing (radians from +z towards +x, the engine's facing) from one point to another. */
export function bearing(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

// ---------------------------------------------------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------------------------------------------------

export interface PlacedFighter {
  id: string
  seat: Seat
  house: Id
  name: string
  typeId: Id
  role: string
  archetype: string
  variant?: string
  pos: Vec2
  facing: number
  baseRadius: number
  height: number
  ranged: HoldClass | null
  melee: HoldClass | null
}

const RANGED_RANK: Record<string, number> = { heavy: 4, special: 3, basic: 2, pistol: 1 }

function holdOf(w: WeaponData): HoldClass {
  switch (w.class) {
    case 'pistol': return 'pistol'
    case 'heavy': return 'heavy'
    case 'grenade': return 'grenade'
    case 'close': return w.flavour === 'crush' || w.flavour === 'maul' ? 'melee2h' : 'melee1h'
    default: return 'rifle'
  }
}

/** Hold classes of a loadout's best ranged weapon and first melee weapon. */
export function holds(bundle: Pick<DataBundle, 'weapons'>, weaponIds: readonly Id[]): { ranged: HoldClass | null; melee: HoldClass | null } {
  let ranged: WeaponData | null = null
  let melee: WeaponData | null = null
  for (const id of weaponIds) {
    const w = bundle.weapons[id]
    if (!w) continue
    if (w.class === 'close') melee ??= w
    else if (w.class !== 'grenade' && (!ranged || (RANGED_RANK[w.class] ?? 0) > (RANGED_RANK[ranged.class] ?? 0))) ranged = w
  }
  return { ranged: ranged ? holdOf(ranged) : null, melee: melee ? holdOf(melee) : null }
}

/** Stand-in figure height (inches above the base) by role: leaders and champions stand a little taller. */
export function heightOf(role: string): number {
  return role === 'leader' ? 2.1 : role === 'champion' ? 1.95 : role === 'juve' || role === 'prospect' ? 1.6 : 1.8
}

export function baseRadiusOf(type: Pick<FighterTypeData, 'base'> | undefined): number {
  return (type?.base ?? 25) / 25.4 / 2
}

/** The fighters of a starter gang placed over `zone`, facing `towards`. Ids are `<seat>1`, `<seat>2`, ... */
export function placeGang(
  bundle: Pick<DataBundle, 'fighterTypes' | 'weapons'>,
  def: BoardDef,
  doors: DoorStates,
  gang: StarterGangData,
  seat: Seat,
  zone: readonly Polygon[],
  towards: Vec2,
): PlacedFighter[] {
  const types = gang.fighters.map((f) => bundle.fighterTypes[f.type])
  const r = Math.max(...types.map((t) => baseRadiusOf(t)), 0.5)
  const spots = spreadInZone(def, doors, zone, r, gang.fighters.length)
  return gang.fighters.slice(0, spots.length).map((f, i) => {
    const t = types[i]
    const h = holds(bundle, f.weapons)
    return {
      id: `${seat}${i + 1}`,
      seat,
      house: gang.house,
      name: f.name,
      typeId: f.type,
      role: t?.role ?? 'ganger',
      archetype: t?.figure.archetype ?? `${gang.house}-ganger`,
      variant: t?.figure.variant,
      pos: spots[i]!,
      facing: bearing(spots[i]!, towards),
      baseRadius: baseRadiusOf(t),
      height: heightOf(t?.role ?? 'ganger'),
      ranged: h.ranged,
      melee: h.melee,
    }
  })
}
