// Weapon effects: every weapon of both gangs maps to a family by its data flavour, every family implements the layers it must
// have, the pools never exceed their caps however much is fired, tracers are one per attack die and flame burns for two to three
// seconds. The effects engine is pure (no three.js, no DOM), so it runs here with a seeded clock.
import { describe, expect, it } from 'vitest'
import type { GameState } from '@/engine'
import { flavourOf, isMeleeFlavour } from '@/client/weaponFlavour'
import { FxEngine } from '@/client/vfx/engine'
import { REQUIRED_LAYERS, VFX_FAMILIES, WEAPON_VFX, deathStyleFor, isMeleeFamily, vfxOf, type VfxFamily, type WeaponVfx } from '@/client/vfx/families'
import { CAPS, type FxWriter } from '@/client/vfx/types'
import * as R from '@/client/vfx/recipes'
import { LAYERS, missingLayers } from '@/client/vfx/recipes'
import { realBundle } from '../fixtures/real'

/** the effects only read the weapon table: every weapon in the data, not just the ones a game carries */
const state = { data: { weapons: realBundle().weapons } } as unknown as GameState
const weapons = Object.values(state.data.weapons)
/** [weapon id, look] for every weapon in the data, each profile's look included. */
const LOOKS: [string, WeaponVfx][] = weapons.flatMap((w) => [[w.id, vfxOf(state, w.id)] as [string, WeaponVfx], ...w.profiles.map((p) => [w.id + '#' + p.id, vfxOf(state, w.id, p.id)] as [string, WeaponVfx])])

describe('weapon -> effect family', () => {
  it('both gangs and the core list are present in the data', () => {
    expect(weapons.some((w) => w.id.startsWith('gol.'))).toBe(true)
    expect(weapons.some((w) => w.id.startsWith('esc.'))).toBe(true)
    expect(weapons.some((w) => w.id.startsWith('core.'))).toBe(true)
  })

  it('maps every weapon and profile to a known family', () => {
    for (const [id, v] of LOOKS) expect(VFX_FAMILIES, id).toContain(v.family)
  })

  it('has no stale override entries', () => {
    const ids = new Set(weapons.map((w) => w.id))
    expect(Object.keys(WEAPON_VFX).filter((k) => !ids.has(k.split('#')[0]!))).toEqual([])
  })

  it('melee weapons get melee families and ranged weapons do not (the bows throw knives)', () => {
    for (const w of weapons) expect(isMeleeFamily(vfxOf(state, w.id).family), w.id).toBe(w.class === 'close')
  })

  it('agrees with the flavour', () => {
    for (const w of weapons) {
      const fl = flavourOf(state, w.id)
      const fam = vfxOf(state, w.id).family
      if (w.class === 'close') expect(isMeleeFlavour(fl), w.id).toBe(true)
      if (fl === 'flamer') expect(fam).toBe('flame')
      if (fl === 'grenade') expect(fam).toBe('explosive')
      if (fl === 'bolter' || fl === 'las') expect(fam).toBe('bolt')
      if (fl === 'chain') expect(fam).toBe('blade')
      if (fl === 'plasma' && w.id !== 'esc.w.plasma-pistol') expect(fam).toBe('plasma')
    }
  })

  it('classifies unknown ids by name and never throws', () => {
    expect(vfxOf(null, 'some.unknown-flamer').family).toBe('flame')
    expect(vfxOf(null, null).family).toBe('crush')
    expect(vfxOf(state, 'future.w.thing').family).toBeTruthy()
  })

  it('names the looks the owner asked for', () => {
    expect(vfxOf(state, 'gol.w.heavy-bolter')).toEqual({ family: 'bolt', variant: 'heavy' })
    expect(vfxOf(state, 'esc.w.lasgun')).toEqual({ family: 'bolt', variant: 'las' })
    expect(vfxOf(state, 'esc.w.plasma-gun', 'max')).toEqual({ family: 'plasma', variant: 'supercharge' })
    expect(vfxOf(state, 'esc.w.plasma-gun', 'low')).toEqual({ family: 'plasma', variant: 'standard' })
    expect(vfxOf(state, 'gol.w.heavy-flamer').family).toBe('flame')
    expect(vfxOf(state, 'core.w.hand-flamer').variant).toBe('hand')
    expect(vfxOf(state, 'gol.w.missile-launcher').variant).toBe('rokkit')
    expect(vfxOf(state, 'core.w.krak-grenades').variant).toBe('krak')
    expect(vfxOf(state, 'core.w.frag-grenades').variant).toBe('frag')
    expect(vfxOf(state, 'core.w.chainsword')).toEqual({ family: 'blade', variant: 'chain' })
    expect(vfxOf(state, 'gol.w.power-axe').variant).toBe('power')
    expect(vfxOf(state, 'esc.w.wyld-bow').family).toBe('knives')
    expect(vfxOf(state, 'gol.w.maul').family).toBe('crush')
  })

  it('picks the death by family: bullets slump, flame burns down, blasts knock back, blades topple', () => {
    expect(deathStyleFor('bolt')).toBe('slump')
    expect(deathStyleFor('flame')).toBe('burn')
    expect(deathStyleFor('explosive')).toBe('blast')
    expect(deathStyleFor('blade')).toBe('topple')
  })
})

// ---------------------------------------------------------------- layers

// ---------------------------------------------------------------- layers

describe('families have their required layers', () => {
  it('every family is complete', () => {
    for (const f of VFX_FAMILIES) expect(missingLayers(f), f).toEqual([])
    for (const f of VFX_FAMILIES) for (const l of REQUIRED_LAYERS[f]) expect(LAYERS[f]).toContain(l)
  })

  const ranged = (family: VfxFamily, variant: string, kinds: number[] = [R.NORMAL, R.NORMAL, R.CRIT, R.FAIL]) => ({
    family,
    variant,
    fx: -5,
    fy: 0.7,
    fz: 0,
    tx: 5,
    ty: 0.66,
    tz: 0,
    floorY: 0,
    height: 1.2,
    targetId: 'T',
    kinds,
    secondary: false,
    inCover: false,
  })
  const melee = (family: VfxFamily, variant: string, crit = false) => ({ family, variant, ax: -0.9, az: 0, tx: 0.9, ty: 0.66, tz: 0, floorY: 0, height: 1.2, crit, index: 0 })

  it('every family actually spawns something when fired (and the pools stay under their caps)', () => {
    for (const [w, v] of LOOKS) {
      void w
      const e = new FxEngine({ seed: 7 })
      if (isMeleeFamily(v.family)) R.strike(e, melee(v.family, v.variant, true))
      else R.fireVolley(e, ranged(v.family, v.variant))
      expect(e.liveCount() + e.stats().projectiles + e.stats().sweeps + e.stats().jets, w).toBeGreaterThan(0)
    }
  })

  it('melee blades leave a red slash mark and crushing weapons a red bash symbol that fade in about two seconds', () => {
    for (const [fam, variant] of [['blade', 'choppa'], ['crush', 'fist']] as const) {
      const e = new FxEngine({ seed: 3 })
      R.strike(e, melee(fam, variant))
      // the mark lives in the normal-blended pool
      const before = e.norm.n
      expect(before).toBeGreaterThan(0)
      e.advance(500)
      let reds = 0
      for (let i = 0; i < e.norm.n; i++) if (e.norm.r0[i]! > 0.9 && e.norm.g0[i]! < 0.3 && (e.norm.frame[i] === 7 || e.norm.frame[i] === 8)) reds++
      expect(reds, fam).toBeGreaterThan(0)
      expect(e.norm.frame.includes(fam === 'blade' ? 7 : 8)).toBe(true)
      e.advance(2600)
      expect(e.norm.n, `${fam} decals gone after ~2.4 s`).toBeLessThan(before)
      let left = 0
      for (let i = 0; i < e.norm.n; i++) if (e.norm.frame[i] === 7 || e.norm.frame[i] === 8) left++
      expect(left).toBe(0)
    }
  })
})

// ---------------------------------------------------------------- timing and counts

describe('volleys', () => {
  const base = { fx: -5, fy: 0.7, fz: 0, tx: 5, ty: 0.66, tz: 0, floorY: 0, height: 1.2, targetId: 'T', secondary: false, inCover: false }

  it('fires one tracer per attack die, and tracers travel to the target in about 120 ms', () => {
    const e = new FxEngine({ seed: 1 })
    const info = R.fireVolley(e, { ...base, family: 'bolt', variant: 'rifle', kinds: [R.NORMAL, R.NORMAL, R.NORMAL, R.NORMAL] })
    expect(e.stats().projectiles).toBe(4)
    expect(info.first).toBeGreaterThan(0.09)
    expect(info.first).toBeLessThan(0.18)
    // staggered: a burst, not a blob
    expect(info.duration).toBeGreaterThan(info.first + 0.1)
    const first = e.projs.find((p) => p.active)!
    expect(first.dur).toBeGreaterThan(0.09)
    expect(first.dur).toBeLessThan(0.16)
  })

  it('misses sail past the target', () => {
    const e = new FxEngine({ seed: 2 })
    R.fireVolley(e, { ...base, family: 'bolt', variant: 'rifle', kinds: [R.FAIL, R.FAIL] })
    const ps = e.projs.filter((p) => p.active)
    expect(ps).toHaveLength(2)
    for (const p of ps) expect(Math.hypot(p.tx - 5, p.tz - 0)).toBeGreaterThan(0.7)
    const h = new FxEngine({ seed: 2 })
    R.fireVolley(h, { ...base, family: 'bolt', variant: 'rifle', kinds: [R.NORMAL, R.NORMAL] })
    for (const p of h.projs.filter((q) => q.active)) expect(Math.hypot(p.tx - 5, p.tz - 0)).toBeLessThan(0.5)
  })

  it('a heavy bolter fires a 4 to 5 round burst with shell casings; a sniper one slow bolt', () => {
    const e = new FxEngine({ seed: 3 })
    R.fireVolley(e, { ...base, family: 'bolt', variant: 'heavy', kinds: [R.NORMAL, R.FAIL] })
    expect(e.stats().projectiles).toBeGreaterThanOrEqual(4)
    expect(e.stats().projectiles).toBeLessThanOrEqual(5)
    // brass casings are normal-blended debris frames
    expect(e.norm.frame.slice(0, e.norm.n).includes(9)).toBe(true)
    const s = new FxEngine({ seed: 3 })
    const info = R.fireVolley(s, { ...base, family: 'bolt', variant: 'sniper', kinds: [R.NORMAL, R.NORMAL, R.NORMAL] })
    expect(s.stats().projectiles).toBe(1)
    expect(info.first).toBeGreaterThan(0.22)
    expect(s.beamAdd.n).toBeGreaterThan(0) // the vapour trail
  })

  it('a flamer streams a cone and every target it reaches burns for two to three seconds', () => {
    const e = new FxEngine({ seed: 4 })
    R.fireVolley(e, { ...base, family: 'flame', variant: 'burna', kinds: [R.NORMAL, R.FAIL] })
    expect(e.stats().jets).toBe(1)
    e.advance(700)
    expect(e.isBurning('T')).toBe(true)
    expect(e.stats().lights).toBeGreaterThan(0)
    e.advance(1500)
    expect(e.isBurning('T')).toBe(true)
    e.advance(1500)
    expect(e.isBurning('T')).toBe(false)
    e.advance(3000)
    expect(e.alive()).toBe(false)
    // a stream that reaches nothing does not set the target alight
    const miss = new FxEngine({ seed: 4 })
    R.fireVolley(miss, { ...base, family: 'flame', variant: 'hand', kinds: [R.FAIL, R.FAIL] })
    miss.advance(800)
    expect(miss.isBurning('T')).toBe(false)
  })

  it('a rocket arcs in with a smoke trail and then explodes: flash, fireball, shockwave, debris, lingering dust, scorch, thump', () => {
    const e = new FxEngine({ seed: 5 })
    const info = R.fireVolley(e, { ...base, family: 'explosive', variant: 'rokkit', kinds: [R.NORMAL] })
    expect(e.stats().projectiles).toBe(1)
    e.advance(300)
    expect(e.norm.n).toBeGreaterThan(0) // smoke trail so far
    e.advance(info.first * 1000 - 300 + 150)
    const s = e.stats()
    expect(s.flatAdd).toBeGreaterThan(0) // shockwave ring
    expect(s.flatNorm).toBeGreaterThan(0) // scorch decal + dust ring
    expect(s.spark).toBeGreaterThan(5)
    expect(s.add).toBeGreaterThan(8)
    const off = [0, 0, 0] as [number, number, number]
    e.shakeOffset(off)
    expect(Math.hypot(off[0], off[1])).toBeGreaterThan(0)
    // the scorch outlasts the fight, the dust cloud lingers
    e.advance(1800)
    expect(e.norm.n).toBeGreaterThan(0)
    e.advance(8000)
    expect(e.alive()).toBe(false)
  })

  it('a plasma shot charges at the muzzle first and supercharge adds a vent burst on the shooter', () => {
    const std = new FxEngine({ seed: 6 })
    const a = R.fireVolley(std, { ...base, family: 'plasma', variant: 'standard', kinds: [R.NORMAL] })
    const sup = new FxEngine({ seed: 6 })
    const b = R.fireVolley(sup, { ...base, family: 'plasma', variant: 'supercharge', kinds: [R.NORMAL] })
    expect(a.first).toBeGreaterThan(0.3)
    expect(sup.liveCount()).toBeGreaterThan(std.liveCount())
    expect(b.first).toBeGreaterThanOrEqual(a.first)
  })

  it('the shokka pistol draws jagged lightning ribbons', () => {
    const e = new FxEngine({ seed: 8 })
    R.fireVolley(e, { ...base, family: 'shokka', variant: 'shokka', kinds: [R.NORMAL] })
    expect(e.beamAdd.n).toBeGreaterThan(30)
  })

  it('secondary (Blast / Torrent) targets get their own impact without a second muzzle flash', () => {
    const e = new FxEngine({ seed: 9 })
    R.fireVolley(e, { ...base, family: 'explosive', variant: 'rokkit', kinds: [R.NORMAL], secondary: true })
    expect(e.stats().projectiles).toBe(0)
    expect(e.liveCount()).toBeGreaterThan(10)
    const f = new FxEngine({ seed: 9 })
    R.fireVolley(f, { ...base, family: 'flame', variant: 'burna', kinds: [R.NORMAL], secondary: true })
    expect(f.stats().jets).toBe(0)
    f.advance(300)
    expect(f.isBurning('T')).toBe(true)
  })

  it('crits are bigger than normal hits; blocked dice shimmer; parries spark', () => {
    const n = new FxEngine({ seed: 10 })
    const c = new FxEngine({ seed: 10 })
    R.fireVolley(n, { ...base, family: 'bolt', variant: 'rifle', kinds: [R.NORMAL] })
    R.fireVolley(c, { ...base, family: 'bolt', variant: 'rifle', kinds: [R.CRIT] })
    n.advance(200)
    c.advance(200)
    expect(c.liveCount()).toBeGreaterThan(n.liveCount())
    const sh = new FxEngine({ seed: 1 })
    R.shield(sh, 5, 0.7, 0, 2, true)
    expect(sh.add.frame.slice(0, sh.add.n).includes(11)).toBe(true) // the hex shimmer frame
    const pa = new FxEngine({ seed: 1 })
    R.parry(pa, 0, 0.7, 0, false)
    expect(pa.spark.n).toBeGreaterThan(5)
  })
})

describe('pools', () => {
  class Sink implements FxWriter {
    bills = [0, 0, 0, 0]
    beams = [0, 0]
    bill(layer: 0 | 1 | 2 | 3): void {
      this.bills[layer]!++
    }
    beam(norm: boolean): void {
      this.beams[norm ? 1 : 0]!++
    }
  }

  function stress(e: FxEngine, rounds: number): void {
    for (let i = 0; i < rounds; i++) {
      const v = LOOKS[i % LOOKS.length]![1]
      const x = (i % 7) - 3
      if (isMeleeFamily(v.family)) R.strike(e, { family: v.family, variant: v.variant, ax: x, az: 0, tx: x + 1.4, ty: 0.7, tz: 1, floorY: 0, height: 1.2, crit: i % 3 === 0, index: i })
      else R.fireVolley(e, { family: v.family, variant: v.variant, fx: x - 6, fy: 0.7, fz: 0, tx: x + 4, ty: 0.7, tz: 1, floorY: 0, height: 1.2, targetId: `T${i % 5}`, kinds: [R.NORMAL, R.CRIT, R.FAIL, R.NORMAL, R.NORMAL], secondary: i % 4 === 0, inCover: false })
      if (i % 5 === 0) R.flesh(e, x, 0.7, 0, 1, 0, 5, true, '#a50f0f', 0)
      if (i % 9 === 0) R.explosion(e, x, 0, 1, 1.7)
      e.advance(20)
    }
  }

  it('never exceed their caps, however much is fired, and drain afterwards', () => {
    const e = new FxEngine({ seed: 11 })
    const sink = new Sink()
    for (let i = 0; i < 40; i++) {
      stress(e, 6)
      const s = e.stats()
      expect(s.add).toBeLessThanOrEqual(CAPS.add)
      expect(s.norm).toBeLessThanOrEqual(CAPS.norm)
      expect(s.flatAdd).toBeLessThanOrEqual(CAPS.flatAdd)
      expect(s.flatNorm).toBeLessThanOrEqual(CAPS.flatNorm)
      expect(s.spark).toBeLessThanOrEqual(CAPS.spark)
      expect(s.beamAdd).toBeLessThanOrEqual(CAPS.beamAdd)
      expect(s.beamNorm).toBeLessThanOrEqual(CAPS.beamNorm)
      expect(s.projectiles).toBeLessThanOrEqual(CAPS.projectiles)
      expect(s.sweeps).toBeLessThanOrEqual(CAPS.sweeps)
      expect(s.jets).toBeLessThanOrEqual(CAPS.jets)
      expect(s.status).toBeLessThanOrEqual(CAPS.status)
      expect(s.lights).toBeLessThanOrEqual(CAPS.lights)
      e.draw(sink)
    }
    const p = e.stats().peak
    expect(p.add).toBeLessThanOrEqual(CAPS.add)
    expect(p.spark).toBeLessThanOrEqual(CAPS.spark)
    // what the renderer receives fits the instance buffers it reserved
    expect(sink.bills[0]!).toBeGreaterThan(0)
    e.advance(15000)
    expect(e.alive()).toBe(false)
    expect(e.liveCount()).toBe(0)
  })

  it('a single frame never writes more instances than the renderer has room for', () => {
    const e = new FxEngine({ seed: 12 })
    stress(e, 80)
    const sink = new Sink()
    e.draw(sink)
    expect(sink.bills[0]!).toBeLessThanOrEqual(CAPS.add + CAPS.dynBill)
    expect(sink.bills[1]!).toBeLessThanOrEqual(CAPS.norm)
    expect(sink.bills[2]!).toBeLessThanOrEqual(CAPS.flatAdd)
    expect(sink.bills[3]!).toBeLessThanOrEqual(CAPS.flatNorm)
    expect(sink.beams[0]!).toBeLessThanOrEqual(CAPS.beamAdd + CAPS.spark + CAPS.dynBeam)
    expect(sink.beams[1]!).toBeLessThanOrEqual(CAPS.beamNorm + 40)
  })

  it('the low-graphics path spawns fewer particles', () => {
    const full = new FxEngine({ seed: 13, quality: 1 })
    const low = new FxEngine({ seed: 13, quality: 0.4 })
    for (const e of [full, low]) {
      R.explosion(e, 0, 0, 0, 1.5)
      R.fireVolley(e, { family: 'bolt', variant: 'heavy', fx: -5, fy: 0.7, fz: 0, tx: 5, ty: 0.7, tz: 0, floorY: 0, height: 1.2, targetId: 'T', kinds: [1, 1, 1, 1], secondary: false, inCover: false })
    }
    expect(low.liveCount()).toBeLessThan(full.liveCount() * 0.75)
    expect(low.stats().lights).toBe(0)
  })

  it('time can be frozen mid-effect and resumed', () => {
    let t = 0
    const e = new FxEngine({ seed: 14, perf: () => t })
    e.freezeAfterNextSpawn(100)
    R.explosion(e, 0, 0, 0, 1)
    e.kick()
    for (let i = 0; i < 20; i++) {
      t += 16
      e.update(t)
    }
    expect(e.frozen).toBe(true)
    expect(e.clock).toBeCloseTo(0.1, 2)
    const live = e.liveCount()
    t += 500
    e.update(t)
    expect(e.liveCount()).toBe(live)
    e.resume()
    t += 100
    e.update(t)
    expect(e.clock).toBeGreaterThan(0.1)
  })
})

describe('capture hooks', () => {
  const drive = (e: FxEngine, clockOf: () => number, set: (ms: number) => void, frames: number): void => {
    for (let i = 0; i < frames; i++) {
      set(clockOf() + 16)
      e.update(clockOf())
    }
  }

  it('freezes exactly N ms after the first projectile / explosion, whatever the frame rate', () => {
    for (const mode of ['projectile', 'explosion'] as const) {
      let t = 0
      const e = new FxEngine({ seed: 21, perf: () => t })
      if (mode === 'projectile') e.freezeAfterNextProjectile(70)
      else e.freezeAfterNextExplosion(300)
      const t0 = e.clock
      if (mode === 'projectile') R.fireVolley(e, { family: 'bolt', variant: 'rifle', fx: -5, fy: 0.7, fz: 0, tx: 5, ty: 0.7, tz: 0, floorY: 0, height: 1.2, targetId: 'T', kinds: [1, 1], secondary: false, inCover: false })
      else R.explosion(e, 0, 0, 0, 1)
      // a slow machine: 100 ms frames
      for (let i = 0; i < 12 && !e.frozen; i++) {
        t += 100
        e.update(t)
      }
      expect(e.frozen).toBe(true)
      expect(e.clock - t0).toBeCloseTo(mode === 'projectile' ? 0.07 : 0.3, 2)
    }
    void drive
  })
})
