// Procedural stand-in for an operative: MGSD-ish capsule body with a big head, a box weapon chosen by hold
// class, the team's two paint hues and a black base disc. Used while a body GLB is missing or loading, and
// in the gallery. Origin at base centre, y up, front +Z, 1 unit = 1 inch (same contract as a GLB body).
import { useMemo } from 'react'
import { Color } from 'three'
import type { HoldClass } from './manifest'
import { BaseRing, FrontMark, baseAxes, isOvalBase } from './OvalBase'

export interface HslLike {
  h: number
  s: number
  l: number
}

export interface WeaponBox {
  /** [width, height, length] in inches */
  size: [number, number, number]
  /** attach position relative to the body centre, as fractions of height */
  at: [number, number, number]
}

const BOX: Record<HoldClass, [number, number, number]> = {
  pistol: [0.1, 0.12, 0.42],
  rifle: [0.12, 0.16, 0.95],
  long: [0.1, 0.12, 1.35],
  heavy: [0.26, 0.28, 1.05],
  melee1h: [0.07, 0.07, 0.75],
  melee2h: [0.2, 0.2, 0.85],
  shield: [0.7, 0.8, 0.08],
  pack: [0.4, 0.5, 0.25],
  grenade: [0.14, 0.14, 0.14],
  tool: [0.12, 0.12, 0.4],
}

export interface ProceduralProps {
  height: number
  baseRadius: number
  major: HslLike
  minor: HslLike
  /** hold class of the ranged weapon (right hand) and the melee weapon (left hand), if any */
  ranged?: HoldClass | null
  melee?: HoldClass | null
  dim?: boolean
  /** seat colour for the base rim */
  seatColor: string
  /** oval bases (engine `ovalHalfAxis`): the base is an ellipse with its long axis along the front (+Z) */
  ovalHalfAxis?: number
}

const hsl = (c: HslLike) => new Color().setHSL(c.h, c.s, c.l)

export function Procedural({ height: h, baseRadius: R, major, minor, ranged, melee, dim, seatColor, ovalHalfAxis }: ProceduralProps) {
  const oval = isOvalBase(ovalHalfAxis)
  const stretch = oval ? baseAxes(R, ovalHalfAxis).rz / R : 1
  const cols = useMemo(
    () => ({
      major: hsl(major),
      minor: hsl(minor),
      skin: hsl({ h: major.h, s: Math.min(1, major.s * 0.6), l: Math.min(0.75, major.l + 0.2) }),
      dark: new Color('#15161a'),
    }),
    [major, minor],
  )
  const legH = h * 0.22
  const torsoH = h * 0.3
  const bodyR = Math.min(R * 0.6, h * 0.3)
  const headR = h * 0.26
  const mat = (c: Color, extra: object = {}) => (
    <meshStandardMaterial color={c} roughness={0.7} metalness={0.15} transparent={dim} opacity={dim ? 0.82 : 1} {...extra} />
  )
  const r = ranged ? BOX[ranged] : null
  const m = melee ? BOX[melee] : null
  return (
    <group>
      {/* base disc + seat rim */}
      <mesh position={[0, 0.03, 0]} scale={[1, 1, stretch]} castShadow>
        <cylinderGeometry args={[R, R, 0.06, 28]} />
        <meshStandardMaterial color={cols.dark} roughness={0.9} />
      </mesh>
      {oval ? (
        <>
          <BaseRing baseRadius={R} ovalHalfAxis={ovalHalfAxis} inner={-R * 0.1} outer={0} color={seatColor} y={0.062} />
          <FrontMark baseRadius={R} ovalHalfAxis={ovalHalfAxis} color={seatColor} y={0.064} />
        </>
      ) : (
        <mesh position={[0, 0.062, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[R * 0.9, R, 28]} />
          <meshBasicMaterial color={seatColor} />
        </mesh>
      )}
      {/* legs */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * bodyR * 0.45, 0.06 + legH / 2, 0.02]} castShadow>
          <boxGeometry args={[bodyR * 0.62, legH, bodyR * 0.9]} />
          {mat(cols.minor)}
        </mesh>
      ))}
      {/* torso */}
      <mesh position={[0, 0.06 + legH + torsoH / 2, 0]} castShadow>
        <capsuleGeometry args={[bodyR, torsoH * 0.6, 6, 12]} />
        {mat(cols.major)}
      </mesh>
      {/* shoulder pads */}
      {[-1, 1].map((s) => (
        <mesh key={`p${s}`} position={[s * bodyR * 1.05, 0.06 + legH + torsoH * 0.85, 0]} castShadow>
          <sphereGeometry args={[bodyR * 0.5, 10, 8]} />
          {mat(cols.minor)}
        </mesh>
      ))}
      {/* head (about 40% of the figure, as wide as the shoulders) */}
      <mesh position={[0, 0.06 + legH + torsoH + headR * 0.8, 0]} castShadow>
        <sphereGeometry args={[headR, 16, 12]} />
        {mat(cols.major)}
      </mesh>
      {/* visor / face plate pointing +Z */}
      <mesh position={[0, 0.06 + legH + torsoH + headR * 0.85, headR * 0.72]}>
        <boxGeometry args={[headR * 1.1, headR * 0.35, headR * 0.5]} />
        {mat(cols.skin)}
      </mesh>
      {/* ranged weapon, right hand */}
      {r && (
        <mesh position={[bodyR * 1.35, 0.06 + legH + torsoH * 0.55, r[2] * 0.3]} castShadow>
          <boxGeometry args={r} />
          {mat(cols.dark)}
        </mesh>
      )}
      {/* melee weapon, left hand */}
      {m && (
        <mesh position={[-bodyR * 1.35, 0.06 + legH + torsoH * 0.5, m[2] * 0.25]} rotation={[-0.25, 0, 0]} castShadow>
          <boxGeometry args={m} />
          {mat(melee === 'melee2h' ? cols.minor : new Color('#b9bdc6'))}
        </mesh>
      )}
    </group>
  )
}
