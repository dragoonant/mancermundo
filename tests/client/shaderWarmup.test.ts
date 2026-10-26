// First-shot stall (iPhone report): three.js builds one program per point-light count for every lit material, and the
// effect batches' programs only on first draw. The effect lights now stay in the scene at intensity 0 (a constant
// light count), and the board compiles every material, hidden effect batches included, at idle after load.
import { describe, expect, it, vi } from 'vitest'
import { Mesh, MeshStandardMaterial, PerspectiveCamera, PointLight, Scene, BoxGeometry, type Material } from 'three'

vi.mock('@/client/vfx/atlas', () => ({ drawAtlas: () => ({ width: 4, height: 4 }) }))

import { FxEngine } from '@/client/vfx/engine'
import { FxRenderer } from '@/client/vfx/renderer'
import { CAPS } from '@/client/vfx/types'
import { sceneMaterials, warmScene, type WarmRenderer } from '@/client/vfx/warmup'

const lightsOf = (r: FxRenderer) => r.group.children.filter((o): o is PointLight => (o as PointLight).isPointLight)

describe('shader warm-up', () => {
  it('effect lights keep a constant visible count through a muzzle flash, dark when idle', () => {
    let now = 0
    const engine = new FxEngine({ perf: () => now, quality: 1 })
    const r = new FxRenderer()
    const visible = () => lightsOf(r).filter((l) => l.visible).length
    r.sync(engine)
    expect(lightsOf(r)).toHaveLength(CAPS.lights)
    expect(visible()).toBe(CAPS.lights)
    expect(lightsOf(r).every((l) => l.intensity === 0)).toBe(true)
    engine.kick()
    engine.light(0, 1, 0, '#ffaa40', 1.4, 0.3)
    now = 30
    engine.update(now)
    r.sync(engine)
    expect(visible()).toBe(CAPS.lights)
    expect(lightsOf(r).some((l) => l.intensity > 0)).toBe(true)
    for (let i = 0; i < 40; i++) {
      now += 50
      engine.update(now)
    }
    r.sync(engine)
    expect(visible()).toBe(CAPS.lights)
    expect(lightsOf(r).every((l) => l.intensity === 0)).toBe(true)
  })

  it('compiles every material in the scene, the hidden effect batches included, and finishes each program', async () => {
    const scene = new Scene()
    const fig = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
    const hidden = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
    hidden.visible = false
    const r = new FxRenderer()
    scene.add(fig, hidden, r.group)
    const fxMats = r.group.children.filter((o) => (o as Mesh).isMesh).map((o) => (o as Mesh).material as Material)
    expect(fxMats).toHaveLength(6)
    const mats = sceneMaterials(scene)
    for (const m of [...fxMats, fig.material, hidden.material]) expect(mats).toContain(m)

    const touched = new Set<Material>()
    const progs = new Map<Material, Map<string, { getUniforms(): unknown }>>()
    const compileAsync = vi.fn(async () => {
      for (const m of sceneMaterials(scene)) progs.set(m, new Map([['k', { getUniforms: () => touched.add(m) }]]))
    })
    const gl: WarmRenderer = { compileAsync, compile: vi.fn(), properties: { get: (m) => ({ programs: progs.get(m as Material) }) } }
    const n = await warmScene(gl, scene, new PerspectiveCamera())
    expect(compileAsync).toHaveBeenCalledTimes(1)
    expect(n).toBe(mats.length)
    for (const m of mats) expect(touched.has(m)).toBe(true)
    // abandoned (board unmounted) before it starts: nothing is compiled
    compileAsync.mockClear()
    expect(await warmScene(gl, scene, new PerspectiveCamera(), () => false)).toBe(0)
    expect(compileAsync).not.toHaveBeenCalled()
  })
})
