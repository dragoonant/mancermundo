// Shader warm-up. three.js compiles a material's program the first time it is drawn, and on a phone a compile
// with shadows costs a visible hitch; the weapon effects' materials are hidden until the first volley, so the first
// shots paid for them mid-animation (and the effects clock, capped per frame, then played in slow motion). Once the
// board is up and the figures have loaded, this compiles every material in the scene (hidden meshes included) at
// idle time, then touches each program a few per task so the blocking link check is spread out, not one long freeze.
import type { Camera, Material, Object3D, Scene } from 'three'

/** The part of three's renderer the warm-up uses (a fake in the unit test). */
export interface WarmRenderer {
  compileAsync?: (scene: Object3D, camera: Camera, targetScene?: Scene | null) => Promise<unknown>
  compile: (scene: Object3D, camera: Camera, targetScene?: Scene | null) => unknown
  properties: { get(m: object): { programs?: Map<string, { getUniforms(): unknown }> } }
}

/** Every material on a drawable object under `root`, visible or not (what three's compile walks). */
export function sceneMaterials(root: Object3D): Material[] {
  const out = new Set<Material>()
  root.traverse((o) => {
    const m = (o as unknown as { material?: Material | Material[]; isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean })
    if (!(m.isMesh || m.isLine || m.isPoints || m.isSprite) || !m.material) return
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) out.add(x)
  })
  return [...out]
}

/** Programs touched per task after the compile (each touch may wait for its link to finish). */
export const TOUCH_PER_TASK = 3

const nextTask = (): Promise<void> =>
  new Promise((r) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
    if (ric) ric(() => r(), { timeout: 300 })
    else setTimeout(r, 16)
  })

/**
 * Compiles every material of `scene` for the current lights and finishes each program's link check, a few per idle
 * task. Returns how many programs were touched. `alive` lets the caller abandon it (board unmounted).
 */
export async function warmScene(gl: WarmRenderer, scene: Scene, camera: Camera, alive: () => boolean = () => true): Promise<number> {
  await nextTask()
  if (!alive()) return 0
  const mats = sceneMaterials(scene)
  try {
    // KHR_parallel_shader_compile (where present) lets compileAsync link in the background
    if (gl.compileAsync) await gl.compileAsync(scene, camera)
    else gl.compile(scene, camera)
  } catch {
    return 0
  }
  const programs = new Set<{ getUniforms(): unknown }>()
  for (const m of mats) for (const p of gl.properties.get(m).programs?.values() ?? []) programs.add(p)
  let n = 0
  for (const p of programs) {
    if (n > 0 && n % TOUCH_PER_TASK === 0) {
      await nextTask()
      if (!alive()) return n
    }
    try {
      p.getUniforms()
    } catch {
      /* a broken program reports itself when drawn */
    }
    n++
  }
  return n
}

