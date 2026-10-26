// Operative figure. `Figure` draws the body (GLB from the manifest when listed and loaded, else the
// procedural stand-in) plus loadout attachments at manifest sockets (HOLDS table in hold.ts); weapons without an
// attachment GLB yet get a team-coloured box of the hold class's length at the socket. `BattleOperative` adds the
// engine position, move tween, rigid cues, order token, APL pips, wound bar and pointer handlers.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Billboard, Html } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Color, DoubleSide, Euler, type Group } from 'three'
import type { Operative as EngineOperative, OperativeToken, Order } from '@/engine'
import { effectiveApl } from '@/engine/state'
import { dataBundle, engineBundle } from '../game/adapter'
import { archetypeFor } from '../teams'
import { animPosition } from '../presentation/animStore'
import { useSettings } from '../presentation/settings'
import { useShotStore } from '../presentation/shotStore'
import { useUi } from '../ui/uiStore'
import { AP_DARK, AP_LIT, ORDER_COLOR, apTip, orderTip, useBoardTip, woundTip, type MarkerTip } from '../ui/markerInfo'
import { tokenDef } from '../ui/tokenDefs'
import { tokenTip } from '../ui/tokenInfo'
import { colors } from '../ui/theme'
import { cuePose, deathAge, deathMs, installCueFeed, isDying, cueActive } from './cues'
import { useGlbInstance } from './glbLoader'
import { attachmentFor } from './attachmentFor'
import { HOLDS, SHEATHED, handRight, heaviestHold, holdClassOf, type HoldSpec } from './hold'
import { modelManifest, pointOf, slugOf, useModelManifest, type BodyEntry, type HoldClass, type ModelManifest, type V3 } from './manifest'
import { BaseRing, OvalPlinth, PulseRing, isOvalBase, setBakedBaseVisible } from './OvalBase'
import { Procedural, type HslLike } from './Procedural'

export interface FigureSpec {
  archetype: string
  height: number
  baseRadius: number
  /** oval bases (engine `ovalHalfAxis`); omitted for a round base */
  ovalHalfAxis?: number
  major: HslLike
  minor: HslLike
  weaponIds: string[]
  /** QC only: mount exactly these attachment slugs (by their hold class) instead of the loadout's weapons */
  attachSlugs?: string[]
  /** picks among the archetype's pose variants (manifest `variants`); the operative id in battle */
  variantKey?: string
  seatColor: string
  dim?: boolean
}

const SEAT_COLOR = { A: colors.playerA, B: colors.playerB }
export const seatColor = (seat: 'A' | 'B'): string => SEAT_COLOR[seat]

export interface ShownWeapon {
  id: string
  hold: HoldClass
  melee: boolean
}

/** The weapons drawn on a figure: the heaviest ranged one and the heaviest named melee one (not bare fists). */
export function shownWeapons(weaponIds: string[]): { ranged: ShownWeapon | null; melee: ShownWeapon | null } {
  const w = engineBundle().weapons
  const pick = (ids: string[], melee: boolean): ShownWeapon | null => {
    if (!ids.length) return null
    const classes = ids.map((id) => holdClassOf(id, w[id]))
    const best = heaviestHold(classes)
    const i = classes.indexOf(best)
    return { id: ids[i]!, hold: best, melee }
  }
  const rangedIds = weaponIds.filter((id) => w[id]?.type === 'ranged')
  const meleeIds = weaponIds.filter((id) => w[id]?.type === 'melee')
  const named = meleeIds.filter((id) => !/fists$/.test(id))
  return { ranged: pick(rangedIds, false), melee: pick(named.length ? named : meleeIds, true) }
}

export function weaponHolds(weaponIds: string[]): { ranged: HoldClass | null; melee: HoldClass | null; all: HoldClass[] } {
  const w = engineBundle().weapons
  const s = shownWeapons(weaponIds)
  return { ranged: s.ranged?.hold ?? null, melee: s.melee?.hold ?? null, all: weaponIds.map((id) => holdClassOf(id, w[id])) }
}

const hslColor = (c: HslLike, lift = 0) => new Color().setHSL(c.h, Math.min(1, c.s + 0.1), Math.min(0.7, Math.max(0.42, c.l + lift)))

/** Group at `socket + offset` with the class's rotation; children are authored barrel-right with the grip at the origin. */
function Mount({ spec, socket, children }: { spec: HoldSpec; socket: V3; children: React.ReactNode }) {
  const rot = useMemo(() => new Euler(spec.rot[0], spec.rot[1], spec.rot[2], 'YXZ'), [spec])
  return (
    <group position={[socket[0] + spec.offset[0], socket[1] + spec.offset[1], socket[2] + spec.offset[2]]} rotation={rot}>
      {children}
    </group>
  )
}

/** One mounted weapon: a real GLB (slug) or the hold-class box (slug null / GLB missing or still loading). */
interface Placed {
  key: string
  slug: string | null
  hold: HoldClass
  spec: HoldSpec
}

function Attachment({ slug, hold, spec, socket, color }: { slug: string | null; hold: HoldClass; spec: HoldSpec; socket: V3; color: Color }) {
  const entry = slug ? modelManifest().attachments[slug] : undefined
  const obj = useGlbInstance(entry ? slugOf(entry.file, 'attachments') : undefined)
  if (!entry || !obj) return <PlaceholderWeapon hold={hold} spec={spec} socket={socket} color={color} />
  const s = entry.scale ?? 1
  const g = pointOf(entry.grip)
  return (
    <Mount spec={spec} socket={socket}>
      <primitive object={obj} scale={s} position={[-g[0] * s, -g[1] * s, -g[2] * s]} />
    </Mount>
  )
}

/** Procedural placeholder for a weapon with no attachment GLB (yet): a thin box of the class length, tinted by team. */
function PlaceholderWeapon({ hold, spec, socket, color }: { hold: HoldClass; spec: HoldSpec; socket: V3; color: Color }) {
  const h = HOLDS[hold]
  return (
    <Mount spec={spec} socket={socket}>
      <mesh position={[(0.5 - h.gripAt) * h.box[0], 0, 0]} castShadow>
        <boxGeometry args={h.box} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.6} />
      </mesh>
    </Mount>
  )
}

/**
 * Which meshes go where for the shown weapons. Slugs come from attachmentFor (an empty list draws nothing, an
 * unmapped id gets the box); the class from the manifest entry when it exists. A second slug of the same weapon
 * (twin choppas) takes the free hand, else hangs at the belt.
 */
export function planAttachments(shown: { ranged: ShownWeapon | null; melee: ShownWeapon | null }, manifest: ModelManifest): Placed[] {
  const out: Placed[] = []
  let rightTaken = false
  const drawn = new Set<string>()
  for (const w of [shown.ranged, shown.melee]) {
    if (!w) continue
    const slugs = attachmentFor(w.id) ?? [null]
    // one physical weapon with a ranged and a melee profile (a stave you shoot and swing) is drawn once
    const key = slugs.join('|')
    if (slugs.length && slugs.every((s) => s !== null) && drawn.has(key)) continue
    if (slugs.length && slugs.every((s) => s !== null)) drawn.add(key)
    slugs.forEach((slug, i) => {
      const hold = (slug && manifest.attachments[slug]?.holdClass) || w.hold
      let spec = HOLDS[hold]
      if (i > 0) spec = rightTaken ? SHEATHED : handRight(spec)
      if (spec.socket === 'handR') rightTaken = true
      out.push({ key: `${w.id}#${i}`, slug, hold, spec })
    })
  }
  return out
}

/** Gallery / QC: mount specific attachment slugs by their own hold class, ignoring the loadout. */
export function planSlugs(slugs: string[], manifest: ModelManifest): Placed[] {
  return slugs.map((slug, i) => {
    const hold = manifest.attachments[slug]?.holdClass ?? 'rifle'
    return { key: `${slug}#${i}`, slug, hold, spec: HOLDS[hold] }
  })
}

export function GlbBody({ body, spec, ranged, melee }: { body: BodyEntry; spec: FigureSpec; ranged: HoldClass | null; melee: HoldClass | null }) {
  const manifest = useModelManifest()
  const obj = useGlbInstance(slugOf(body.file, 'bodies'))
  const shown = useMemo(() => shownWeapons(spec.weaponIds), [spec.weaponIds])
  const cols = useMemo(() => ({ ranged: hslColor(spec.minor, 0.1), melee: hslColor(spec.major, 0.12) }), [spec.major, spec.minor])
  // v2 bodies carry their weapons in the mesh: nothing is mounted (QC slugs still are)
  const placed = useMemo(() => (spec.attachSlugs ? planSlugs(spec.attachSlugs, manifest) : body.weaponsBaked ? [] : planAttachments(shown, manifest)), [spec.attachSlugs, shown, manifest, body.weaponsBaked])
  if (!obj) return <Procedural height={spec.height} baseRadius={spec.baseRadius} ovalHalfAxis={spec.ovalHalfAxis} major={spec.major} minor={spec.minor} ranged={ranged} melee={melee} seatColor={spec.seatColor} dim={spec.dim} />
  const sockets = body.sockets ?? {}
  // natural weapons (no hand sockets, e.g. the bomb squig) draw nothing
  const armed = !!(sockets.handR || sockets.handL)
  const flip = body.facing === '-Z'
  // an oval footprint (engine ovalHalfAxis): hide the GLB's round disc and stand the figure on the oval plinth instead
  const oval = isOvalBase(spec.ovalHalfAxis)
  setBakedBaseVisible(obj, !oval)
  return (
    <group>
      <group rotation={[0, flip ? Math.PI : 0, 0]}>
        <primitive object={obj} />
      </group>
      {oval && <OvalPlinth baseRadius={spec.baseRadius} ovalHalfAxis={spec.ovalHalfAxis} height={body.baseTopIn ?? 0.12} seatColor={spec.attachSlugs ? undefined : spec.seatColor} />}
      {armed &&
        placed.map((p) => {
          const sock = sockets[p.spec.socket]
          if (!sock) return null
          // manifest sockets are in the displayed +Z-facing frame
          return <Attachment key={p.key} slug={p.slug} hold={p.hold} spec={p.spec} socket={sock} color={p.spec.socket === 'handL' ? cols.melee : cols.ranged} />
        })}
    </group>
  )
}

/** The body for an archetype, or one of its pose variants chosen by a stable hash of `key` (the operative id). */
export function pickBody(manifest: ModelManifest, archetype: string, key?: string): BodyEntry | undefined {
  const base = manifest.bodies[archetype]
  if (!base?.variants?.length || !key) return base
  const pool = [archetype, ...base.variants]
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return manifest.bodies[pool[h % pool.length]!] ?? base
}

/** Body + attachments. Falls back to the stand-in for any archetype the manifest does not list. */
export function Figure({ spec }: { spec: FigureSpec }) {
  const manifest = useModelManifest()
  const holds = useMemo(() => weaponHolds(spec.weaponIds), [spec.weaponIds])
  const body = pickBody(manifest, spec.archetype, spec.variantKey)
  if (body) return <GlbBody body={body} spec={spec} ranged={holds.ranged} melee={holds.melee} />
  return (
    <Procedural
      height={spec.height}
      baseRadius={spec.baseRadius}
      ovalHalfAxis={spec.ovalHalfAxis}
      major={spec.major}
      minor={spec.minor}
      ranged={holds.ranged}
      melee={holds.melee}
      seatColor={spec.seatColor}
      dim={spec.dim}
    />
  )
}

/** True when the manifest lists a real body GLB for the archetype (gallery uses this for its label). */
export function hasGlbBody(archetype: string, manifest = modelManifest()): boolean {
  return !!manifest.bodies[archetype]
}

// ---------------------------------------------------------------- battle layer

/** Hover area for one overhead marker: an invisible plane (the pips are too small to hit) that feeds the
 *  board tooltip. Mouse/pen only; on touch the tap selects the operative and the card shows the legend. */
function TipArea({ tip, w, h, y, children }: { tip: MarkerTip; w: number; h: number; y: number; children: ReactNode }) {
  const over = useRef(false)
  const show = (e: ThreeEvent<PointerEvent>) => {
    if (e.pointerType === 'touch') return
    over.current = true
    useBoardTip.setState({ tip: { ...tip, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } })
  }
  const hide = () => {
    if (!over.current) return
    over.current = false
    useBoardTip.setState({ tip: null })
  }
  useEffect(() => hide, [])
  return (
    <group position={[0, y, 0]} onPointerOver={show} onPointerMove={show} onPointerOut={hide}>
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {children}
    </group>
  )
}

function OrderToken({ order }: { order: Order }) {
  return (
    <mesh>
      {order === 'engage' ? <octahedronGeometry args={[0.2, 0]} /> : <boxGeometry args={[0.28, 0.28, 0.28]} />}
      <meshBasicMaterial color={ORDER_COLOR[order]} />
    </mesh>
  )
}

function Pips({ count, lit }: { count: number; lit: number }) {
  const gap = 0.24
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} position={[(i - (count - 1) / 2) * gap, 0, 0]}>
          <circleGeometry args={[0.085, 12]} />
          <meshBasicMaterial color={i < lit ? AP_LIT : AP_DARK} />
        </mesh>
      ))}
    </>
  )
}

/** One token stack as small glyphs (a filled polygon or a ring in the kind colour), one per token up to four. */
function TokenGlyphs({ kind, count }: { kind: string; count: number }) {
  const g = tokenDef(kind).glyph
  const gap = 0.22
  const n = Math.min(count, 4)
  // a badge kind (Frenzy) is drawn larger inside a halo ring so it reads from across the killzone
  const k = g.badge ? 1.9 : 1
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[(i - (n - 1) / 2) * gap * k, 0, 0]} scale={k}>
          <mesh rotation={[0, 0, g.sides === 4 ? 0 : Math.PI / 2]}>
            {g.ring ? <ringGeometry args={[0.055, 0.1, g.sides]} /> : <circleGeometry args={[0.1, g.sides]} />}
            <meshBasicMaterial color={g.color} side={DoubleSide} />
          </mesh>
          {g.badge && (
            <mesh position={[0, 0, -0.001]}>
              <ringGeometry args={[0.12, 0.15, 24]} />
              <meshBasicMaterial color="#ffffff" side={DoubleSide} />
            </mesh>
          )}
        </group>
      ))}
    </>
  )
}

function WoundBar({ ratio }: { ratio: number }) {
  const w = 1.1
  const r = Math.max(0, Math.min(1, ratio))
  const color = r > 0.6 ? '#5fd35f' : r > 0.3 ? '#e6c84a' : '#e0463c'
  return (
    <group>
      <mesh>
        <planeGeometry args={[w + 0.06, 0.16]} />
        <meshBasicMaterial color="#05050a" />
      </mesh>
      <mesh position={[-(w * (1 - r)) / 2, 0, 0.001]}>
        <planeGeometry args={[Math.max(0.001, w * r), 0.1]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  )
}

export interface BattleOperativeProps {
  op: EngineOperative
  /** the activation the engine is running for this operative, if any */
  apSpent: number | null
  selected: boolean
  hovered: boolean
  /** highlighted as a clickable choice (ready to activate) */
  choosable: boolean
  onSelect(id: string): void
  onHover(id: string | null): void
}

// ------------------------------------------------ rigid cues + corpses

function applyPose(g: Group | null, id: string, now: number, walking: boolean, phase: number): boolean {
  if (!g) return false
  const p = cuePose(id, now, walking, phase)
  g.position.set(p.dx, p.dy, p.dz)
  g.rotation.set(p.rx, p.ry, p.rz)
  g.scale.set(p.vis, p.vis * p.sy, p.vis)
  return walking || cueActive(id, now)
}

interface Corpse {
  id: string
  spec: FigureSpec
  pos: [number, number, number]
  facing: number
}
const corpses = new Map<string, Corpse>()
const corpseListeners = new Set<() => void>()
const emitCorpses = () => corpseListeners.forEach((l) => l())

/** Death topple for operatives the engine has already removed. Board mounts one `<Corpses />` next to the operatives. */
export function Corpses() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const l = () => setTick((n) => n + 1)
    corpseListeners.add(l)
    return () => {
      corpseListeners.delete(l)
    }
  }, [])
  return (
    <>
      {[...corpses.values()].map((c) => (
        <CorpseFigure key={c.id} corpse={c} />
      ))}
    </>
  )
}

function CorpseFigure({ corpse }: { corpse: Corpse }) {
  const ref = useRef<Group>(null)
  useFrame((state) => {
    const age = deathAge(corpse.id)
    if (age < 0 || age > deathMs(corpse.id) + 40) {
      if (corpses.delete(corpse.id)) emitCorpses()
      return
    }
    applyPose(ref.current, corpse.id, performance.now(), false, 0)
    state.invalidate()
  })
  return (
    <group position={corpse.pos} rotation={[0, corpse.facing, 0]}>
      <group ref={ref}>
        <Figure spec={corpse.spec} />
      </group>
    </group>
  )
}

export function BattleOperative({ op, apSpent, selected, hovered, choosable, onSelect, onHover }: BattleOperativeProps) {
  const ref = useRef<Group>(null)
  const poseRef = useRef<Group>(null)
  const phase = useMemo(() => (op.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 63) / 10, [op.id])
  const team = dataBundle().teams[teamOf(op)]
  const paint = team?.paint ?? { major: { h: 0.6, s: 0.5, l: 0.4 }, minor: { h: 0.1, s: 0.6, l: 0.4 } }
  // M9 batch C: a body per loadout where the team lists one (v2 bodies hold their weapons)
  const archetype = archetypeFor(op.datacardId, (dataBundle().byId[op.datacardId] as { figure?: { archetype: string } } | undefined)?.figure?.archetype ?? op.datacardId, op.weapons, dataBundle().weaponGroups)
  const spec: FigureSpec = useMemo(
    () => ({ archetype, height: op.height, baseRadius: op.baseRadius, ...(op.ovalHalfAxis ? { ovalHalfAxis: op.ovalHalfAxis } : {}), major: paint.major, minor: paint.minor, weaponIds: op.weapons, seatColor: seatColor(op.seat), dim: !op.ready, variantKey: op.id }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [archetype, op.height, op.baseRadius, op.ovalHalfAxis, op.weapons, op.seat, op.ready, team],
  )
  useEffect(() => installCueFeed(), [])
  const last = useRef({ spec, pos: op.pos, facing: op.facing })
  last.current = { spec, pos: op.pos, facing: op.facing }
  useEffect(
    () => () => {
      // removed from the board while a death cue is running: hand the body to the corpse layer
      if (isDying(op.id)) {
        const l = last.current
        corpses.set(op.id, { id: op.id, spec: l.spec, pos: [l.pos.x, l.pos.y, l.pos.z], facing: l.facing })
        emitCorpses()
      }
    },
    [op.id],
  )
  useFrame((state) => {
    const g = ref.current
    if (!g) return
    const a = animPosition(op.id)
    // idle breathe only shows on frames that are drawn anyway (the board is demand-driven); walk bob and
    // shoot / melee / hit cues keep requesting frames while they run
    if (applyPose(poseRef.current, op.id, performance.now(), !!a, phase)) state.invalidate()
    if (a) {
      g.position.set(a.x, a.y, a.z)
      g.rotation.y = a.heading
      state.invalidate()
    } else {
      g.position.set(op.pos.x, op.pos.y, op.pos.z)
      g.rotation.y = op.facing
    }
  })
  // touch: the operative tapped and waiting for the confirm gets the strong pulse
  const picked = useUi((u) => u.pendingActivate === op.id)
  const lowGraphics = useSettings((u) => u.lowGraphics)
  // the shot camera sits right behind the shooter: its overhead markers would fill the frame
  const markersHidden = useShotStore((u) => u.hideMarkersOf === op.id)
  const apl = effectiveApl(op)
  const lit = apSpent !== null ? Math.max(0, apl - apSpent) : op.ready ? apl : 0
  const top = op.height
  return (
    <group
      ref={ref}
      position={[op.pos.x, op.pos.y, op.pos.z]}
      rotation={[0, op.facing, 0]}
      data-op={op.id}
      onClick={(e) => {
        if (e.delta > 6) return
        e.stopPropagation()
        onSelect(op.id)
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        onHover(op.id)
      }}
      onPointerOut={() => onHover(null)}
    >
      <group ref={poseRef}>
        <Figure spec={spec} />
      </group>
      {(selected || hovered) && (
        <BaseRing baseRadius={op.baseRadius} ovalHalfAxis={op.ovalHalfAxis} inner={0.08} outer={choosable ? 0.3 : 0.2} color={selected ? '#ffffff' : '#9aa0b8'} opacity={0.9} y={0.08} />
      )}
      {choosable && <PulseRing baseRadius={op.baseRadius} ovalHalfAxis={op.ovalHalfAxis} color={picked ? '#6dff9a' : '#ffe066'} strong={picked} animate={!lowGraphics} />}
      {!markersHidden && (
      <Billboard position={[0, top + 0.3, 0]} follow>
        <TipArea tip={orderTip(op.order)} w={0.5} h={0.4} y={0.62}>
          <OrderToken order={op.order} />
        </TipArea>
        <TipArea tip={apTip(apl, lit, apSpent !== null, op.ready)} w={Math.max(0.5, apl * 0.24 + 0.1)} h={0.26} y={0.28}>
          <Pips count={apl} lit={lit} />
        </TipArea>
        <TipArea tip={woundTip(op.wounds, op.maxWounds, op.flags.injured)} w={1.2} h={0.24} y={0}>
          <WoundBar ratio={op.wounds / op.maxWounds} />
        </TipArea>
        {tokenLayout(op.tokens).map((t) => (
          <group key={t.key} position={[t.x, 0, 0]}>
            <TipArea tip={tokenTip(t.token)} w={t.w} h={0.26} y={-0.3}>
              <TokenGlyphs kind={t.token.kind} count={t.token.count} />
            </TipArea>
          </group>
        ))}
      </Billboard>
      )}
      {(selected || hovered) && !markersHidden && (
        <Html position={[0, top + 1.25, 0]} center zIndexRange={[10, 0]} distanceFactor={14} style={{ pointerEvents: 'none' }}>
          <div style={{ background: 'rgba(8,8,14,0.85)', color: '#fff', font: '600 11px system-ui', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>
            {op.id} {op.name} {op.wounds}/{op.maxWounds}
          </div>
        </Html>
      )}
    </group>
  )
}

/** Left-to-right x offsets (centred) for the operative's token stacks under its wound bar. */
function tokenLayout(tokens: EngineOperative['tokens']): { key: string; token: OperativeToken; x: number; w: number }[] {
  const list = (tokens ?? []).filter((t) => t.count > 0)
  const widths = list.map((t) => Math.min(t.count, 4) * 0.22 * (tokenDef(t.kind).glyph.badge ? 1.9 : 1) + 0.04)
  const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, list.length - 1) * 0.08
  let at = -total / 2
  return list.map((t, i) => {
    const x = at + widths[i]! / 2
    at += widths[i]! + 0.08
    return { key: `${t.kind}:${t.owner}`, token: t, x, w: widths[i]! }
  })
}

function teamOf(op: EngineOperative): string {
  const card = dataBundle().byId[op.datacardId] as { team?: string } | undefined
  return card?.team ?? ''
}
