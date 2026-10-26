// ?gallery: every body GLB loads, no console errors, placeholder weapons sit at the measured sockets, and the real
// attachment GLBs (public/assets/models/attachments) load and show on the attachment pages.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { screenshotRendered } from './helpers'

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/assets/models/manifest.json'), 'utf8')) as { attachments: Record<string, unknown> }
const attachmentCount = Object.keys(manifest.attachments).length

test.use({ viewport: { width: 2200, height: 1250 } })

test('gallery loads every body GLB and draws sockets', async ({ page }) => {
  test.setTimeout(120_000) // software GL shares the machine with the long play specs
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('./?gallery')
  await page.getByTestId('gallery').waitFor()
  await page.waitForFunction(() => {
    const ms = window.__ms as unknown as { glbBodiesLoaded?: () => number } | undefined
    return (ms?.glbBodiesLoaded?.() ?? 0) >= 20
  }, undefined, { timeout: 60_000 })

  const stats = await page.evaluate(() => (window.__ms as unknown as { glbStats(p?: string): { loaded: number; failed: number; maxMs: number; totalMs: number } }).glbStats('bodies/'))
  console.log(`gallery bodies: ${JSON.stringify(stats)}`)
  expect(stats.loaded).toBeGreaterThanOrEqual(20)
  expect(stats.failed).toBe(0)

  await page.getByTestId('view-front').click()
  await screenshotRendered(page, 'e2e-out/gallery-01.png')

  await page.getByTestId('view-three-quarter').click()
  await page.getByTestId('toggle-sockets').click()
  await screenshotRendered(page, 'e2e-out/gallery-02.png')

  // team close-ups with sockets on, for the socket QC pass
  await page.getByTestId('team-0').click()
  await page.getByTestId('view-front').click()
  await screenshotRendered(page, 'e2e-out/gallery-03-team0-front.png')
  await page.getByTestId('view-three-quarter').click()
  await screenshotRendered(page, 'e2e-out/gallery-04-team0-3q.png')
  await page.getByTestId('team-1').click()
  await page.getByTestId('view-front').click()
  await screenshotRendered(page, 'e2e-out/gallery-05-team1-front.png')
  await page.getByTestId('view-three-quarter').click()
  await screenshotRendered(page, 'e2e-out/gallery-06-team1-3q.png')

  expect(errors).toEqual([])
})

test('gallery attachment pages show every real attachment GLB in hand', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('./?gallery')
  await page.getByTestId('gallery').waitFor()
  await page.waitForFunction(() => {
    const ms = window.__ms as unknown as { glbBodiesLoaded?: () => number } | undefined
    return (ms?.glbBodiesLoaded?.() ?? 0) >= 20
  }, undefined, { timeout: 60_000 })
  expect(attachmentCount).toBeGreaterThanOrEqual(15)

  const loaded = () => page.evaluate(() => (window.__ms as unknown as { attachmentsLoaded(): number }).attachmentsLoaded())
  const settle = async (n: number) => {
    await page.waitForFunction((want) => (window.__ms as unknown as { attachmentsLoaded(): number }).attachmentsLoaded() >= want, n, { timeout: 60_000 })
  }

  await page.getByTestId('att-kom').click()
  await settle(15)
  await page.getByTestId('view-front').click()
  await screenshotRendered(page, 'e2e-out/gallery-attach-01.png')

  await page.getByTestId('att-aod').click()
  if (attachmentCount >= 31) await settle(31)
  await screenshotRendered(page, 'e2e-out/gallery-attach-02.png')

  // close-up pages (8 per page) for the orientation / grip QC pass
  for (const [team, pages] of [['kom', 2], ['aod', 2]] as const) {
    await page.getByTestId(`att-${team}`).click()
    for (let p = 0; p < pages; p++) {
      await page.getByTestId(`att-page-${p}`).click()
      await screenshotRendered(page, `e2e-out/gallery-attach-${team}-p${p + 1}.png`)
    }
  }

  // the M9 teams' pages: the bodies gallery only draws the attachments of each body's default loadout, so the
  // manifest's full set loads once every team page has been shown
  for (const team of ['pf', 'ht', 'pm', 'wb', 'lg', 'ha', 'hc', 'hk']) {
    await page.getByTestId(`att-${team}`).click()
    await page.getByTestId('att-page-all').click()
  }
  await settle(attachmentCount)
  await screenshotRendered(page, 'e2e-out/gallery-attach-03-m9.png')

  const stats = await page.evaluate(() => (window.__ms as unknown as { glbStats(p?: string): { loaded: number; failed: number; maxMs: number } }).glbStats('attachments/'))
  console.log(`gallery attachments: ${JSON.stringify(stats)} of ${attachmentCount} listed`)
  expect(await loaded()).toBe(attachmentCount)
  expect(stats.failed).toBe(0)
  expect(errors).toEqual([])
})
