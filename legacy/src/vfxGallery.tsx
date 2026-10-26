// vfx.html: the weapon effects gallery. One button per weapon (plus the extras: parry, cover shimmer, deaths,
// burning, a full burst of everything), fired from a dummy shooter at a dummy target through the same api the
// presentation director uses, on the same demand-driven canvas, so effects can be tuned in isolation.
// Query: ?fx=low reduces particle counts (as in the game), ?fire=<weapon id>[&hit=hit|miss|crit|mixed] fires once on load.
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { SRGBColorSpace } from 'three'
import type { Group } from 'three'
import type { Operative } from '@/engine'
import * as vfx from './client/vfx/api'
import * as R from './client/vfx/recipes'
import { drawAtlas } from './client/vfx/atlas'
import { fx, lowFx } from './client/vfx/instance'
import { isMeleeFamily, vfxOf } from './client/vfx/families'
import { Vfx } from './client/board/Vfx'
import { Procedural } from './client/figures/Procedural'
import { spawnFx, clearFx } from './client/presentation/fxStore'
import { aimCue, clearCues, cueActive, cuePose, setCueRepaint, setDeathStyle, triggerCue } from './client/figures/cueCore'
import { WEAPON_VFX } from './client/vfx/families'

type Hit = 'hit' | 'miss' | 'crit' | 'mixed'
type Kind = 'fail' | 'normal' | 'crit'

const KINDS: Record<Hit, Kind[]> = {
  hit: ['normal', 'normal', 'normal', 'normal'],
  miss: ['fail', 'fail', 'fail', 'fail'],
  crit: ['crit', 'normal', 'crit', 'normal'],
  mixed: ['normal', 'fail', 'crit', 'normal', 'fail'],
}

function dummy(id: string, x: number, z: number, facing: number, seat: 'A' | 'B'): Operative {
  return { id, seat, pos: { x, y: 0, z }, facing, baseRadius: 0.5, height: 1.2, wounds: 10, maxWounds: 10, status: 'active', flags: { injured: false } } as unknown as Operative
}

const GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Bolt', ids: ['aod.w.bolt-rifle', 'aod.w.auto-bolt-rifle', 'aod.w.bolt-pistol', 'aod.w.heavy-bolt-pistol', 'aod.w.stalker-bolt-rifle-heavy', 'aod.w.heavy-bolter-focused', 'aod.w.bolt-sniper-rifle-mortis'] },
  { title: 'Plasma', ids: ['aod.w.plasma-pistol-standard', 'aod.w.plasma-pistol-supercharge'] },
  { title: 'Flame', ids: ['aod.w.hand-flamer', 'kom.w.burna-standard', 'kom.w.burna-deluge'] },
  { title: 'Explosive', ids: ['kom.w.rokkit-launcha-aimed', 'aod.w.aux-grenade-launcher-frag', 'aod.w.aux-grenade-launcher-krak', 'core.w.frag-grenade', 'kom.w.dynamite', 'kom.w.explosives'] },
  { title: 'Greenskin guns', ids: ['kom.w.slugga', 'kom.w.dakka-shoota-short', 'kom.w.scoped-big-shoota-stationary', 'kom.w.shokka-pistol', 'kom.w.harpoon', 'kom.w.throwing-knives'] },
  { title: 'Blades', ids: ['aod.w.chainsword-assault', 'aod.w.power-weapon-assault', 'kom.w.choppa', 'kom.w.big-choppa', 'kom.w.twin-choppas', 'kom.w.grot-choppa'] },
  { title: 'Crushing', ids: ['aod.w.power-fist-assault', 'aod.w.thunder-hammer-assault', 'kom.w.power-klaw', 'kom.w.breacha-ram', 'aod.w.fists', 'kom.w.bite'] },
]

const short = (id: string): string => id.replace(/^(aod|kom|core)\.w\./, '')

declare global {
  interface Window {
    __gallery?: { camera(dist: number, tx: number, tz: number): void }
  }
}

/** Cue time follows the effects engine's clock, so pausing the engine pauses the figures too. */
const cueNow = (): number => fx.t() * 1000

/** Applies the figure cues (recoil, flinch, turn, death styles) to a dummy, as BattleOperative does. */
function Pose({ id, children }: { id: string; children: React.ReactNode }) {
  const ref = useRef<Group>(null)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => setCueRepaint(invalidate), [invalidate])
  useFrame((state) => {
    const g = ref.current
    if (!g) return
    const now = cueNow()
    const p = cuePose(id, now, false)
    g.position.set(p.dx, p.dy, p.dz)
    g.rotation.set(p.rx, p.ry, p.rz)
    g.scale.set(p.vis, p.vis * p.sy, p.vis)
    if (cueActive(id, now) && !fx.frozen) state.invalidate()
  })
  return <group ref={ref}>{children}</group>
}

function Scene({ distance }: { distance: number }) {
  const invalidate = useThree((s) => s.invalidate)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: { set(x: number, y: number, z: number): void }; update(): void } | null
  useEffect(() => invalidate(), [invalidate, distance])
  // e2e / tuning hook: put the camera `dist` inches from the point (tx, tz), at the board camera's elevation
  useEffect(() => {
    window.__gallery = {
      camera(dist, tx, tz) {
        const dir = [0, 25, 20]
        const l = Math.hypot(dir[0]!, dir[1]!, dir[2]!)
        camera.position.set(tx + (dir[0]! / l) * dist, (dir[1]! / l) * dist, tz + (dir[2]! / l) * dist)
        controls?.target.set(tx, 0, tz)
        camera.lookAt(tx, 0, tz)
        controls?.update()
        invalidate()
      },
    }
  }, [camera, controls, invalidate])
  const shooter = useMemo(() => dummy('S', -distance / 2, 0, Math.PI / 2, 'A'), [distance])
  const target = useMemo(() => dummy('T', distance / 2, 0, -Math.PI / 2, 'B'), [distance])
  const second = useMemo(() => dummy('T2', distance / 2 + 1.4, 1.1, -Math.PI / 2, 'B'), [distance])
  const hsl = (h: number) => ({ h, s: 0.5, l: 0.42 })
  return (
    <>
      <color attach="background" args={['#0a0a10']} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#aab8d0', '#20222a', 0.5]} />
      <directionalLight position={[9, 22, 12]} intensity={1.5} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <planeGeometry args={[40, 26]} />
        <meshStandardMaterial color="#3a3f46" roughness={0.92} />
      </mesh>
      <gridHelper args={[40, 40, '#4a5058', '#2e3238']} position={[0, 0.002, 0]} />
      {[shooter, target, second].map((o, i) => (
        <group key={o.id} position={[o.pos.x, 0, o.pos.z]} rotation={[0, o.facing, 0]}>
          <Pose id={o.id}>
            <Procedural height={1.2} baseRadius={0.5} major={hsl(i === 0 ? 0.6 : 0.3)} minor={hsl(i === 0 ? 0.12 : 0.02)} ranged="rifle" melee="melee1h" seatColor={i === 0 ? '#4fb0ff' : '#ff6a4f'} />
          </Pose>
        </group>
      ))}
      <Vfx />
      <OrbitControls makeDefault target={[0, 0, 1]} maxPolarAngle={Math.PI / 2.05} />
    </>
  )
}

/** One full attack, as the director plays it: weapon, then wound and number when something got through. */
function fire(weaponId: string, hit: Hit, distance: number, extra: { secondary?: boolean; cover?: boolean }): void {
  const shooter = dummy('S', -distance / 2, 0, Math.PI / 2, 'A')
  const target = dummy('T', distance / 2, 0, -Math.PI / 2, 'B')
  const kinds = KINDS[hit]
  const v = vfxOf(weaponId)
  const anyHit = kinds.some((k) => k !== 'fail')
  const crit = kinds.includes('crit')
  const at = cueNow()
  aimCue('S', 0, 900, at)
  triggerCue('S', isMeleeFamily(v.family) ? 'melee' : 'shoot', at, 'beat')
  if (isMeleeFamily(v.family)) {
    const close = dummy('T', distance / 2, 0, -Math.PI / 2, 'B')
    const me = dummy('S', -distance / 2, 0, Math.PI / 2, 'A')
    let i = 0
    const blow = () => {
      if (hit === 'miss') {
        vfx.parry(close, me, false)
        return
      }
      const c = hit === 'crit' || (hit === 'mixed' && i === 1)
      triggerCue('T', 'hit', cueNow(), 'beat')
      vfx.strike(me, close, weaponId, c, i++)
      vfx.flesh(close, { x: me.pos.x, z: me.pos.z }, c ? 4 : 2, c, '#a50f0f')
      spawnFx({ kind: 'text', to: [close.pos.x, 1.7, 0], color: c ? '#ff9a2a' : '#ff5a4f', text: c ? '-4' : '-2', dur: 1150, size: c ? 1.35 : 1 })
      if (c) spawnFx({ kind: 'text', to: [close.pos.x, 2.3, 0], color: '#ff9a2a', text: 'CRIT', dur: 1250, size: 1.2 })
    }
    blow()
    if (hit !== 'miss') setTimeout(blow, 650)
    return
  }
  const info = vfx.volley(shooter, target, weaponId, kinds, !!extra.secondary, !!extra.cover)
  if (extra.cover) setTimeout(() => vfx.shield(target, 2, true), info.duration * 1000 + 250)
  if (anyHit) {
    setTimeout(() => {
      triggerCue('T', 'hit', cueNow(), 'beat')
      vfx.flesh(target, { x: shooter.pos.x, z: shooter.pos.z }, 2, crit, '#a50f0f')
      spawnFx({ kind: 'text', to: [target.pos.x, 1.7, 0], color: crit ? '#ff9a2a' : '#ff5a4f', text: crit ? '-4' : '-2', dur: 1150, size: crit ? 1.35 : 1 })
      if (crit) spawnFx({ kind: 'text', to: [target.pos.x, 2.3, 0], color: '#ff9a2a', text: 'CRIT', dur: 1250, size: 1.2 })
    }, info.first * 1000 + 120)
  }
}

function Gallery() {
  const params = useMemo(() => new URLSearchParams(location.search), [])
  const [hit, setHit] = useState<Hit>((params.get('hit') as Hit) || 'mixed')
  const [distance, setDistance] = useState(10)
  const [cover, setCover] = useState(false)
  const [low, setLow] = useState(lowFx())
  const [stats, setStats] = useState('')
  const [atlas, setAtlas] = useState(false)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const first = params.get('fire')
    if (first) {
      const t = setTimeout(() => fire(first, hit, distance, { cover }), 700)
      return () => clearTimeout(t)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      const s = fx.stats()
      setStats(`live ${fx.liveCount()}  add ${s.add}/${s.peak.add}  norm ${s.norm}/${s.peak.norm}  spark ${s.spark}/${s.peak.spark}  beams ${s.beamAdd + s.beamNorm}  draw ${s.billboards}+${s.beams}  dropped ${s.dropped}`)
    }, 200)
    return () => clearInterval(t)
  }, [])

  const click = (id: string) => fire(id, hit, distance, { cover })
  const burst = () => {
    for (const id of ['aod.w.heavy-bolter-focused', 'kom.w.dakka-shoota-short', 'aod.w.plasma-pistol-supercharge', 'kom.w.rokkit-launcha-aimed', 'kom.w.shokka-pistol', 'aod.w.hand-flamer']) fire(id, 'crit', distance, {})
  }
  const btn = { font: '600 12px system-ui', color: '#e8e8f2', background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 5, padding: '5px 8px', cursor: 'pointer' } as const
  const target = dummy('T', distance / 2, 0, -Math.PI / 2, 'B')
  const shooter = dummy('S', -distance / 2, 0, Math.PI / 2, 'A')

  return (
    <div style={{ position: 'fixed', inset: 0, fontFamily: 'system-ui, sans-serif', color: '#e8e8f2' }}>
      <div style={{ position: 'absolute', left: 350, right: 0, top: 0, bottom: 0 }}>
      <Canvas
        data-testid="vfx-canvas"
        camera={{ position: [0, 25, 21], fov: 42, near: 0.1, far: 200 }}
        frameloop="demand"
        dpr={low ? 1 : [1, 2]}
        gl={{ antialias: !low, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SRGBColorSpace
        }}
      >
        <Scene distance={distance} />
      </Canvas>
      </div>
      <div style={{ position: 'absolute', left: 8, top: 8, width: 330, maxHeight: 'calc(100% - 16px)', overflowY: 'auto', background: 'rgba(14,15,22,0.9)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 10 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Weapon effects</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
          {(['hit', 'miss', 'crit', 'mixed'] as Hit[]).map((h) => (
            <button key={h} data-testid={`hit-${h}`} style={{ ...btn, background: hit === h ? '#f5d95a' : btn.background, color: hit === h ? '#1a1a12' : btn.color }} onClick={() => setHit(h)}>
              {h}
            </button>
          ))}
          <label style={{ fontSize: 12, alignSelf: 'center' }}>
            <input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} /> cover
          </label>
        </div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          distance {distance}
          <input type="range" min={1.6} max={18} step={0.2} value={distance} onChange={(e) => setDistance(Number(e.target.value))} style={{ width: 170, marginLeft: 6 }} />
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: '#9aa0b8', textTransform: 'uppercase' }}>{g.title}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {g.ids.map((id) => (
                <button key={id} data-testid={`fire-${id}`} style={btn} onClick={() => click(id)}>
                  {short(id)}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: '#9aa0b8', textTransform: 'uppercase' }}>Extras</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
          <button style={btn} data-testid="x-parry" onClick={() => vfx.parry(target, shooter, false)}>parry</button>
          <button style={btn} data-testid="x-cover" onClick={() => vfx.shield(target, 2, true)}>cover shimmer</button>
          <button style={btn} data-testid="x-armour" onClick={() => vfx.shield(target, 2, false)}>armour shimmer</button>
          <button style={btn} data-testid="x-burn" onClick={() => R.ignite(fx, 'T', target.pos.x, 0, target.pos.z, 1.2)}>burn</button>
          <button style={btn} data-testid="x-injured" onClick={() => vfx.wound(target)}>injured</button>
          <button style={btn} data-testid="x-heal" onClick={() => fx.injured('T', false)}>heal</button>
          {(['slump', 'burn', 'blast', 'topple'] as const).map((s) => (
            <button key={s} style={btn} data-testid={`x-death-${s}`} onClick={() => {
                const plan = vfx.death(target, s === 'slump' ? 'bolt' : s === 'burn' ? 'flame' : s === 'blast' ? 'explosive' : 'blade', { x: shooter.pos.x, z: shooter.pos.z }, '#a50f0f')
                setDeathStyle('T', plan)
                triggerCue('T', 'death', cueNow(), 'beat')
              }}>
              death {s}
            </button>
          ))}
          <button style={btn} data-testid="x-burst" onClick={burst}>full burst</button>
          <button style={btn} data-testid="x-clear" onClick={() => { vfx.resetFx(); clearFx(); clearCues(); fx.kick() }}>clear</button>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
          <button style={btn} data-testid="pause" onClick={() => { if (paused) fx.resume(); else fx.freeze(); setPaused(!paused) }}>{paused ? 'resume' : 'pause'}</button>
          <button style={btn} data-testid="step" onClick={() => { fx.frozen = true; fx.advance(50); fx.onWake?.(); setPaused(true) }}>step 50 ms</button>
          <button style={btn} onClick={() => setLow(!low)} data-testid="low">{low ? 'fx: low (reload with ?fx=low)' : 'fx: full'}</button>
          <button style={btn} data-testid="atlas" onClick={() => setAtlas(!atlas)}>atlas</button>
        </div>
        <div data-testid="vfx-stats" style={{ fontSize: 11, color: '#9aa0b8', fontFamily: 'ui-monospace, Consolas, monospace', whiteSpace: 'pre-wrap' }}>{stats}</div>
        <div style={{ fontSize: 11, color: '#9aa0b8', marginTop: 6 }}>{Object.keys(WEAPON_VFX).length} weapons mapped</div>
      </div>
      {atlas && <AtlasView />}
    </div>
  )
}

function AtlasView() {
  const url = useMemo(() => drawAtlas().toDataURL('image/png'), [])
  return (
    <div style={{ position: 'absolute', right: 8, top: 8, background: '#202028 repeating-conic-gradient(#2a2a34 0% 25%, #1c1c24 0% 50%) 0 0 / 24px 24px', padding: 6, border: '1px solid #555', borderRadius: 8 }}>
      <img src={url} width={512} height={512} alt="effects atlas" style={{ display: 'block' }} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
)
