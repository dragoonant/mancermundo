// Terrain GLBs on the board: every manifest terrain slug used by the layout loads, no console errors, pieces sit on
// the mat (overview + three-quarter close-up screenshots for the eyeball check).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { screenshotRendered } from './helpers'

const layout = JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/killzones/volkus-01.json'), 'utf8')) as { pieces: { model: string }[] }
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/assets/models/manifest.json'), 'utf8')) as { terrain: Record<string, unknown> }
const slugs = [...new Set(layout.pieces.map((p) => p.model))].filter((s) => s in manifest.terrain)

test.use({ viewport: { width: 1600, height: 900 } })
test.describe.configure({ mode: 'serial' }) // the demand-driven canvases need a foreground page each

test('terrain GLBs load, fit and draw on the mat', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('./?test=1&seats=human,bot&seed=7&layout=volkus-01&speed=instant')
  await page.getByTestId('battle').waitFor()
  await page.waitForFunction(() => !!window.__ms?.getState())
  await page.waitForFunction(
    (n) => ((window.__ms as unknown as { glbTerrainLoaded?: () => number } | undefined)?.glbTerrainLoaded?.() ?? 0) >= n,
    slugs.length,
    { timeout: 60_000 },
  )
  const stats = await page.evaluate(() => (window.__ms as unknown as { glbTerrainStats(): { loaded: number; failed: number; maxMs: number } }).glbTerrainStats())
  console.log(`terrain glbs: ${JSON.stringify(stats)}`)
  expect(slugs.length).toBeGreaterThanOrEqual(6)
  expect(stats.loaded).toBe(slugs.length)
  expect(stats.failed).toBe(0)

  await screenshotRendered(page, 'e2e-out/terrain-01.png')

  // close three-quarter view of the first large ruin (p01 at -4.75, -4.75)
  await page.evaluate(() => window.__ms?.camera.current?.lookAt(-4.75, -4.75, 13))
  await screenshotRendered(page, 'e2e-out/terrain-02.png')

  expect(errors).toEqual([])
})

test('a piece between the camera and a selected operative fades to 35%', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('./?test=1&seats=bot,bot&seed=7&layout=volkus-01&speed=instant')
  await page.getByTestId('battle').waitFor()
  await page.waitForFunction(() => !!window.__ms?.getState())
  // let the bots deploy, then select every operative in turn at the default camera
  await page.waitForFunction(
    () => {
      const ms = window.__ms!
      ms.autoStep()
      const s = ms.getState() as { phase: string }
      return s.phase !== 'setup'
    },
    undefined,
    { timeout: 60_000, polling: 5 },
  )
  await page.waitForFunction(() => ((window.__ms as unknown as { glbTerrainLoaded?: () => number }).glbTerrainLoaded?.() ?? 0) >= 6)
  const faded = await page.evaluate(async () => {
    const ms = window.__ms as unknown as { getState(): { operatives: Record<string, { id: string; status: string }> }; ui(): { set(p: object): void }; terrainFade(): Record<string, number>; camera: { current: { repaint(): void } } }
    const frame = () => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), 80))
    let min = 1
    for (const o of Object.values(ms.getState().operatives).filter((x) => x.status === 'active')) {
      ms.ui().set({ selectedOp: o.id })
      for (let i = 0; i < 15 && min >= 0.5; i++) {
        ms.camera.current.repaint()
        await frame()
        min = Math.min(min, ...Object.values(ms.terrainFade()))
      }
      if (min < 0.5) break
    }
    return min
  })
  expect(faded).toBeLessThan(0.5)
})
