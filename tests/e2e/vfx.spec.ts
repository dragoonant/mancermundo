// Weapon effects in the real game. Plays a Shoot (auto bolt rifle at a Boy in cover, then a frag grenade at a Grot)
// and a Fight (Assault Intercessor against the Boss Nob) at normal speed, freezes the effects engine mid-effect by
// sampling its state every animation frame (window.__vfx), and writes e2e-out/vfx-01..06.png at the default camera
// distance. Neither scenario has a crushing weapon in play, so vfx-05.png (the red bash symbol of a power fist) comes
// from the gallery (vfx.html), where the same test also fires a full burst of every family for the perf numbers and
// checks that the ?fx=low path spawns fewer particles.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { startBattle } from './helpers'

mkdirSync('e2e-out', { recursive: true })

// atlas frames (src/client/vfx/types.ts)
const HEX = 11
const SLASH = 7
const BASH = 8
const DROP = 14

/** Freeze the effects engine the first animation frame `cond` (JS over `s` stats, `f` live frames, `v` the hook) holds. */
async function freezeWhen(page: Page, cond: string, timeout = 30_000): Promise<boolean> {
  try {
    await page.waitForFunction(
      `(() => { const v = window.__vfx; if (!v) return false; if (v.frozen()) return true; const s = v.stats(), f = v.frames(); if (${cond}) { v.freeze(); return true } return false })()`,
      undefined,
      { polling: 'raf', timeout },
    )
    return true
  } catch {
    return false
  }
}

/** Screenshot of the frozen board, then let the effects run on. */
async function shoot(page: Page, path: string): Promise<void> {
  await page.evaluate(() => {
    window.__ms?.camera.current?.repaint()
    return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  })
  await page.waitForTimeout(200)
  await page.screenshot({ path })
  await page.evaluate(() => window.__vfx?.resume())
}

/**
 * Play the game inside the page: answers every open decision (both seats are human in a scenario) from a script of
 * picks per decision kind, taken in order; command re-roll and ploy offers are declined. Keeps going on its own so the
 * spec only has to watch the effects.
 */
async function autopilot(page: Page, script: Record<string, string[]>): Promise<void> {
  await page.evaluate((sc) => {
    const queues: Record<string, string[]> = JSON.parse(JSON.stringify(sc))
    const ms = window.__ms!
    const timer = setInterval(() => {
      if (!ms.settled()) return
      const p = ms.getPending() as { id: string; seat: string; kind: string; canPass: boolean; options?: { id: string }[] } | null
      if (!p) return
      if ((p.kind === 'dice.commandReroll' || p.kind === 'ploy.firefight') && p.canPass) {
        ms.dispatch({ type: 'pass', seat: p.seat, decisionId: p.id, payload: {} } as never)
        return
      }
      const q = queues[p.kind]
      const ids = (p.options ?? []).map((o) => o.id)
      const want = q && q.length > 0 ? q.shift()! : null
      const pick = (want && ids.find((i) => i === want || i.startsWith(want))) || ids[0]
      if (pick) ms.choose(pick)
    }, 40)
    ;(window as unknown as { __autopilot: () => void }).__autopilot = () => clearInterval(timer)
  }, script)
}

test('shoot and fight at normal speed show muzzle flash, tracers, shimmer, blood, marks and an explosion', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  const frozen: Record<string, boolean> = {}

  // ---------------------------------------------------------------- shoot: bolt volley, then a frag grenade
  await startBattle(page, '?scenario=shoot-cover&speed=normal&seed=vfx-a')
  await page.waitForFunction(() => window.__ms!.settled() && !!window.__ms!.camera.current)
  await page.evaluate(() => window.__vfx!.freezeAfterNextProjectile(70))
  await autopilot(page, {
    'firefight.activate': ['A6'],
    'firefight.order': ['engage'],
    'firefight.action': ['shoot', 'shoot', 'end'],
    'shoot.weapon': ['aod.w.auto-bolt-rifle', 'aod.w.aux-grenade-launcher-frag'],
    'shoot.target': ['B2', 'B11'],
    'shoot.coverSave': ['roll'],
  })

  // 01: muzzle flash and a burst of tracers in flight, caught 70 ms of effect time after the first one leaves
  frozen['01'] = await freezeWhen(page, 'v.frozen()')
  await shoot(page, 'e2e-out/vfx-01.png')

  // 02: the cover save: a shimmer of hexagons on the defender
  frozen['02'] = await freezeWhen(page, `f.add.includes(${HEX})`)
  await shoot(page, 'e2e-out/vfx-02.png')

  // 03: a wound: blood mist and droplets with the floating damage number (a DOM label, so not frozen: shot at once)
  try {
    // the label fades in over its first 150 ms and out over the next second: shoot it as soon as it is fully shown
    await page.waitForFunction(
      () => {
        const e = document.querySelector('[data-testid="fx-text"]')
        return !!e && parseFloat(getComputedStyle(e).opacity) > 0.9
      },
      undefined,
      { polling: 'raf', timeout: 30_000 },
    )
    await page.screenshot({ path: 'e2e-out/vfx-03.png' })
    frozen['03'] = true
  } catch {
    frozen['03'] = false
  }

  // 06: the frag grenade: arc, fireball, shockwave, debris and dust, caught 0.3 s into the explosion
  await page.evaluate(() => window.__vfx!.freezeAfterNextExplosion(300))
  frozen['06'] = await freezeWhen(page, 'v.frozen()', 60_000)
  await shoot(page, 'e2e-out/vfx-06.png')
  await page.evaluate(() => (window as unknown as { __autopilot: () => void }).__autopilot())

  // ---------------------------------------------------------------- fight: blade sweep + red slash, crush + red bash
  await startBattle(page, '?scenario=fight&speed=normal&seed=vfx-b')
  await page.waitForFunction(() => window.__ms!.settled() && !!window.__ms!.camera.current)
  await autopilot(page, {
    'firefight.activate': ['A3'],
    'firefight.order': ['engage'],
    'firefight.action': ['fight', 'end'],
    'fight.target': ['B2'],
    'fight.resolve': ['strike', 'strike', 'block', 'strike', 'strike', 'strike', 'strike'],
  })
  // 04: the red slash mark on the enemy the blade struck
  frozen['04'] = await freezeWhen(page, `f.norm.includes(${SLASH})`)
  await shoot(page, 'e2e-out/vfx-04.png')
  await page.waitForFunction(() => window.__ms!.settled(), undefined, { timeout: 40_000 })
  await page.evaluate(() => (window as unknown as { __autopilot: () => void }).__autopilot())

  console.log(`vfx frozen: ${JSON.stringify(frozen)}`)
  expect(errors).toEqual([])
  for (const k of ['01', '02', '03', '04', '06']) expect(frozen[k], `effect ${k} was caught mid-flight`).toBe(true)
})

test('gallery: a power fist leaves the red bash symbol; a full burst of every family stays inside the caps; ?fx=low spawns fewer particles', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  // 05: a power fist lands: heavy flash, dust ring, thump and the red bash symbol on the enemy
  await page.goto('./vfx.html')
  await page.getByTestId('vfx-canvas').waitFor()
  await page.waitForFunction(() => !!window.__vfx && !!window.__gallery)
  await page.evaluate(() => window.__gallery!.camera(16, 0, 0.4))
  await page.evaluate(() => {
    const slider = document.querySelector('input[type=range]') as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '2')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByTestId('hit-hit').click()
  await page.evaluate(() => window.__vfx!.freezeAfterNextSpawn(380))
  await page.getByTestId('fire-aod.w.power-fist-assault').click()
  expect(await freezeWhen(page, 'v.frozen()', 10_000)).toBe(true)
  expect(await page.evaluate(() => window.__vfx!.frames().norm)).toContain(BASH)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'e2e-out/vfx-05.png' })
  const run = async (query: string, shot: string) => {
    await page.goto(`./vfx.html${query}`)
    await page.getByTestId('vfx-canvas').waitFor()
    await page.waitForFunction(() => !!window.__vfx && !!window.__gallery)
    await page.evaluate(() => window.__gallery!.camera(26, 0, 0.4))
    await page.getByTestId('hit-crit').click()
    // fire everything at once and sample the frame times while it plays
    await page.evaluate(() => window.__vfx!.resetCpu())
    await page.getByTestId('x-burst').click()
    const sample = await page.evaluate(
      () =>
        new Promise<{ peak: number; frames: number; avgMs: number; maxMs: number; dropped: number; cpuAvg: number; cpuPeak: number; drawn: number }>((resolve) => {
          const t0 = performance.now()
          let last = t0
          let frames = 0
          let worst = 0
          let peak = 0
          const tick = (now: number) => {
            frames++
            worst = Math.max(worst, now - last)
            last = now
            peak = Math.max(peak, window.__vfx!.stats().live)
            if (now - t0 < 1500) requestAnimationFrame(tick)
            else {
              const st = window.__vfx!.stats()
              resolve({ peak, frames, avgMs: (now - t0) / frames, maxMs: worst, dropped: st.dropped, cpuAvg: st.cpu.avg, cpuPeak: st.cpu.peak, drawn: st.cpu.peakDraw })
            }
          }
          requestAnimationFrame(tick)
        }),
    )
    await page.screenshot({ path: shot })
    return sample
  }
  const full = await run('', 'e2e-out/vfx-gallery-burst.png')
  const low = await run('?fx=low', 'e2e-out/vfx-gallery-burst-low.png')
  console.log(`vfx burst (software GL, six families at once): full peak ${full.peak} live particles, ${full.drawn} instances drawn in the busiest frame, frame ${full.avgMs.toFixed(1)} ms avg / ${full.maxMs.toFixed(1)} ms worst, effects CPU ${full.cpuAvg.toFixed(2)} ms avg / ${full.cpuPeak.toFixed(2)} ms peak; low peak ${low.peak} live, frame ${low.avgMs.toFixed(1)} ms, effects CPU ${low.cpuAvg.toFixed(2)} ms`)
  expect(full.peak).toBeGreaterThan(150)
  expect(low.peak).toBeLessThan(full.peak * 0.8)
  expect(errors).toEqual([])
})
