// Synthetic killzones for engine tests. 30 x 22, drop zones along the two short edges.
import type { MapDef, Polygon, TerrainFeatureDef, TerrainPartDef, TerrainTrait } from '@/engine/types'

export function rect(x0: number, x1: number, z0: number, z1: number): Polygon {
  return [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ]
}

export function part(
  id: string,
  footprint: Polygon,
  height: number,
  traits: TerrainTrait[],
  extra: Partial<TerrainPartDef> = {},
): TerrainPartDef {
  return { id, footprint, height, traits, ...extra }
}

export function feature(id: string, ...parts: TerrainPartDef[]): TerrainFeatureDef {
  return { id, parts }
}

export function mapWith(...features: TerrainFeatureDef[]): MapDef {
  return {
    id: 'test-map',
    size: { x: 30, z: 22 },
    dropZones: [
      { id: 'north', polygon: rect(-15, 15, -11, -8) },
      { id: 'south', polygon: rect(-15, 15, 8, 11) },
    ],
    features,
  }
}

export function flatMap(): MapDef {
  return mapWith()
}

/** A varied layout used by the simulator: a Heavy wall, rubble, a gate with an Accessible door and Vantage steps. */
export function terrainMap(): MapDef {
  return mapWith(
    feature('wall', part('wall.a', rect(-0.25, 0.25, -3, 3), 3, ['heavy'])),
    feature('rubble', part('rubble.a', rect(-9, -7, 3.5, 4.5), 1, ['light'])),
    feature(
      'gate',
      part('gate.left', rect(-2, -0.5, -5.25, -4.75), 3, ['heavy']),
      part('gate.right', rect(0.5, 2, -5.25, -4.75), 3, ['heavy']),
      part('gate.door', rect(-0.5, 0.5, -5.25, -4.75), 3, ['heavy', 'accessible']),
    ),
    feature(
      'tower',
      part('tower.low', rect(8, 11, -2, 2), 3, ['vantage']),
      part('tower.high', rect(11, 13, -2, 2), 5, ['vantage']),
    ),
    feature('step', part('step.a', rect(4, 6, 4, 6), 1, ['vantage'])),
    feature(
      'jump',
      part('jump.a', rect(-13, -10.5, -2, 2), 3, ['vantage']),
      part('jump.b', rect(-8, -5.5, -2, 2), 3, ['vantage']),
    ),
  )
}
