// Floor textures: ?mat=<id> loads the generated mat (window.__ms.mat() reports it), no console errors, and the
// screenshots in e2e-out/mat-<id>.png are the eyeball check that terrain, figures and the grid still read.
import { expect, test } from '@playwright/test'
import { screenshotRendered } from './helpers'

test.use({ viewport: { width: 1600, height: 900 } })
test.describe.configure({ mode: 'serial' }) // the demand-driven canvases need a foreground page each

const IDS = (process.env.MAT_IDS ?? 'plasteel-deck,blood-foundry').split(',')

for (const id of IDS) {
  test(`mat ${id} renders`, async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(`./?test=1&seats=human,bot&seed=1&mat=${id}&speed=instant`)
    await page.getByTestId('battle').waitFor()
    await page.waitForFunction(() => !!window.__ms?.getState())
    await page.waitForFunction(() => (window.__ms as unknown as { matLoaded?: () => boolean } | undefined)?.matLoaded?.() === true, undefined, { timeout: 30_000 })
    expect(await page.evaluate(() => (window.__ms as unknown as { mat(): string }).mat())).toBe(id)
    // let the setup run (both seats auto-answered) so figures stand on the mat in the screenshot
    await page.waitForFunction(
      () => {
        const ms = window.__ms!
        ms.autoStep()
        return (ms.getState() as { phase: string }).phase !== 'setup'
      },
      undefined,
      { timeout: 60_000, polling: 5 },
    )
    await page.waitForFunction(() => window.__ms?.settled() === true, undefined, { timeout: 30_000 })
    await screenshotRendered(page, `e2e-out/mat-${id}.png`)
    expect(errors).toEqual([])
  })
}
