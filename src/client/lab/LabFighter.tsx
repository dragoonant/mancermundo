// One fighter in the lab: the body GLB when the model manifest lists one for the archetype (loaded without suspending, meshopt
// aware), else the procedural stand-in tinted by house. Plus the seat ring on the base and a facing wedge. Origin at the base
// centre, y up, front +Z; `facing` is the engine bearing (from +z towards +x), which is exactly a rotation about +y.
import { colors } from '../ui/theme'
import { bodyFor, useBodyManifest } from '../figures/bodyManifest'
import { useGlbInstance } from '../figures/glbLoader'
import { Procedural, type HslLike } from '../figures/Procedural'
import type { PlacedFighter, Seat } from './placement'

export interface HousePaint {
  major: HslLike
  minor: HslLike
}

/** House paint schemes: Goliath rust-red with bronze, Escher magenta with acid green; anything else a neutral steel. */
export const HOUSE_PAINT: Record<string, HousePaint> = {
  goliath: { major: { h: 0.015, s: 0.72, l: 0.36 }, minor: { h: 0.095, s: 0.6, l: 0.44 } },
  escher: { major: { h: 0.865, s: 0.72, l: 0.42 }, minor: { h: 0.235, s: 0.85, l: 0.5 } },
}
const NEUTRAL: HousePaint = { major: { h: 0.6, s: 0.2, l: 0.42 }, minor: { h: 0.1, s: 0.3, l: 0.45 } }

export const SEAT_COLOR: Record<Seat, string> = { A: colors.playerA, B: colors.playerB }

/** The body of a fighter: the manifest GLB when it lists one for the archetype, else the procedural stand-in (no facing wedge). */
export function FighterBody({ f }: { f: PlacedFighter }) {
  const manifest = useBodyManifest()
  const paint = HOUSE_PAINT[f.house] ?? NEUTRAL
  const body = bodyFor(manifest, f.archetype, f.id)
  const glbSlug = body?.slug
  const flip = body?.flip ?? false
  const seatColor = SEAT_COLOR[f.seat]
  // the stand-in is drawn until the GLB is ready (useGlbInstance returns null meanwhile); once a GLB exists the stand-in goes
  return glbSlug ? (
    <GlbOrStandIn slug={glbSlug} flip={flip} f={f} paint={paint} seatColor={seatColor} />
  ) : (
    <Procedural height={f.height} baseRadius={f.baseRadius} major={paint.major} minor={paint.minor} ranged={f.ranged} melee={f.melee} seatColor={seatColor} />
  )
}

export function LabFighter({ f }: { f: PlacedFighter }) {
  const seatColor = SEAT_COLOR[f.seat]
  const R = f.baseRadius
  return (
    <group position={[f.pos.x, 0, f.pos.z]} rotation={[0, f.facing, 0]} name={`fighter-${f.id}`}>
      <FighterBody f={f} />
      {/* facing wedge on the floor in front of the base */}
      <mesh position={[0, 0.06, R + 0.38]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.22]}>
        <coneGeometry args={[R * 0.5, 0.7, 3]} />
        <meshBasicMaterial color={seatColor} />
      </mesh>
    </group>
  )
}

function GlbOrStandIn({ slug, flip, f, paint, seatColor }: { slug: string; flip: boolean; f: PlacedFighter; paint: HousePaint; seatColor: string }) {
  const obj = useGlbInstance(slug)
  if (!obj) return <Procedural height={f.height} baseRadius={f.baseRadius} major={paint.major} minor={paint.minor} ranged={f.ranged} melee={f.melee} seatColor={seatColor} />
  return (
    <group>
      <primitive object={obj} rotation={[0, flip ? Math.PI : 0, 0]} />
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[f.baseRadius * 0.96, f.baseRadius * 1.08, 28]} />
        <meshBasicMaterial color={seatColor} transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  )
}
