// Weapon -> hold class (docs/spec/30-figures.md section 2). Drives the stand-in's weapon box and picks the
// GLB pose / socket for an attachment. Pure: shared by the stand-in, the GLB path and tests.
import { flavourOf } from '../weaponFlavour'
import type { HoldClass, SocketName, V3 } from './manifest'

export interface WeaponLike {
  type: 'ranged' | 'melee'
  name: string
  rules: { rule: string; inches?: number }[]
}

const RANK: HoldClass[] = ['grenade', 'tool', 'pack', 'shield', 'pistol', 'melee1h', 'rifle', 'melee2h', 'long', 'heavy']

export function holdClassOf(weaponId: string, w?: WeaponLike): HoldClass {
  const name = `${weaponId} ${w?.name ?? ''}`.toLowerCase()
  const flavour = flavourOf(weaponId)
  const melee = w ? w.type === 'melee' : flavour === 'chain' || flavour === 'crush' || flavour === 'blade' || flavour === 'bite'
  if (melee) {
    if (flavour === 'crush' || /klaw|fist|hammer|ram|big-choppa|big choppa/.test(name)) return 'melee2h'
    return 'melee1h'
  }
  if (/grenade|explos|dynamite/.test(name)) return 'grenade'
  if (/sniper|snipa|stalker/.test(name)) return 'long'
  if (flavour === 'rokkit' || /heavy bolter|heavy-bolter|big-shoota|big shoota|launch/.test(name)) return 'heavy'
  const range = w?.rules.find((r) => /(^|\.)range$/.test(r.rule))
  if (range && (range.inches ?? 99) <= 8) return 'pistol'
  if (/pistol|slugga|knives/.test(name)) return 'pistol'
  return 'rifle'
}

/** The class a loadout's pose is picked by: the heaviest of its weapons. */
export function heaviestHold(classes: HoldClass[]): HoldClass {
  let best: HoldClass = 'rifle'
  let bestRank = -1
  for (const c of classes) {
    const r = RANK.indexOf(c)
    if (r > bestRank) {
      best = c
      bestRank = r
    }
  }
  return best
}

// ---------------------------------------------------------------- HOLDS (docs/spec/30-figures.md section 3-4)
/**
 * How an attachment is mounted on a body, per hold class. An attachment mesh is authored horizontal with the
 * barrel / blade pointing +X (right), origin anywhere; `gripAt` is the fraction of its length (0 = stock end,
 * 1 = muzzle / tip) that sits in the hand. The attachment group is placed at `socket + offset` (body frame:
 * +Z front, right = -X) with Euler (YXZ) `rot`: ry = -PI/2 turns barrel-right into barrel-forward (+Z), rz
 * then elevates the barrel (positive = muzzle up), rx rolls it about its own axis.
 */
export interface HoldSpec {
  socket: SocketName
  offset: V3
  rot: V3
  gripAt: number
  /** placeholder box: length along the barrel, height, width (inches) */
  box: V3
}

const FWD = -Math.PI / 2

export const HOLDS: Record<HoldClass, HoldSpec> = {
  // right-hand firearms: muzzle forward, a touch up; pistols angled up and slightly inward, long guns and
  // heavy weapons carried lower (hip) and crossed a little toward the support hand
  pistol: { socket: 'handR', offset: [0, 0.02, 0.04], rot: [0, FWD + 0.1, 0.22], gripAt: 0.2, box: [0.42, 0.12, 0.1] },
  rifle: { socket: 'handR', offset: [0, 0.03, 0.04], rot: [0, FWD, 0.1], gripAt: 0.38, box: [0.95, 0.16, 0.12] },
  long: { socket: 'handR', offset: [0, 0.03, 0.04], rot: [0, FWD + 0.18, 0.08], gripAt: 0.32, box: [1.35, 0.12, 0.1] },
  heavy: { socket: 'handR', offset: [0, 0.02, 0.04], rot: [0, FWD + 0.28, 0.02], gripAt: 0.42, box: [1.05, 0.28, 0.26] },
  // left-hand melee: held down and forward
  melee1h: { socket: 'handL', offset: [0, 0.03, 0.03], rot: [0, FWD - 0.08, -0.5], gripAt: 0.12, box: [0.75, 0.07, 0.07] },
  melee2h: { socket: 'handL', offset: [0, 0.03, 0.03], rot: [0, FWD - 0.08, -0.25], gripAt: 0.3, box: [0.85, 0.2, 0.2] },
  shield: { socket: 'handL', offset: [-0.06, 0.12, 0.1], rot: [0, 0, 0], gripAt: 0.5, box: [0.7, 0.8, 0.08] },
  pack: { socket: 'back', offset: [0, 0, -0.12], rot: [0, 0, 0], gripAt: 0.5, box: [0.4, 0.5, 0.25] },
  grenade: { socket: 'beltR', offset: [0, 0, 0.04], rot: [0, 0, 0], gripAt: 0.5, box: [0.14, 0.14, 0.14] },
  tool: { socket: 'handL', offset: [0, 0.02, 0.04], rot: [0, FWD, 0.3], gripAt: 0.3, box: [0.4, 0.12, 0.12] },
}

/** A second one-handed weapon of a pair, hanging at the right belt pointing down-forward. */
export const SHEATHED: HoldSpec = { socket: 'beltR', offset: [0, -0.02, 0.04], rot: [0, FWD, -1.1], gripAt: 0.15, box: [0.6, 0.07, 0.07] }

/** The same hold mirrored onto the right hand (the second weapon of a pair when the right hand is free). */
export function handRight(s: HoldSpec): HoldSpec {
  return { ...s, socket: 'handR', offset: [-s.offset[0], s.offset[1], s.offset[2]], rot: [s.rot[0], FWD - (s.rot[1] - FWD), s.rot[2]] }
}

/** Placeholder length of a hold class's attachment (the data carries no per-weapon length yet). */
export const holdLengthIn = (c: HoldClass): number => HOLDS[c].box[0]
