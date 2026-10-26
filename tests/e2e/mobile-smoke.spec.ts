// Phone layout smoke (M7). Runs on the three mobile projects (iphone-se, iphone-pro, pixel; landscape). A staged
// shoot-cover game: every drawer opens inside the screen, the activation bar and the shoot prompts fit, and every button
// in the prompt layer is at least 44 px. Screenshots land in e2e-out/mobile-<project>-0N.png.
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { screenshotRendered, startBattle } from './helpers'

const MIN_TOUCH = 44

async function shot(page: Page, info: TestInfo, n: number): Promise<void> {
  await screenshotRendered(page, `e2e-out/mobile-${info.project.name}-${String(n).padStart(2, '0')}.png`, 20_000)
}

/** Visible buttons (and button-like links) whose box is under the touch minimum, as text. */
async function smallTargets(scope: Locator): Promise<string[]> {
  return scope.evaluate((root, min) => {
    const out: string[] = []
    for (const b of Array.from(root.querySelectorAll('button, [role="button"], a[href], input, select'))) {
      // a checkbox or radio is tapped through its label
      const hit = b instanceof HTMLInputElement && (b.type === 'checkbox' || b.type === 'radio') ? (b.closest('label') ?? b) : b
      const r = hit.getBoundingClientRect()
      const cs = getComputedStyle(b)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
      const vw = window.innerWidth
      const vh = window.innerHeight
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue
      if (r.height < min - 0.5 || r.width < min - 0.5) out.push(`${(b.textContent || b.getAttribute('aria-label') || b.getAttribute('data-testid') || b.tagName).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    return out
  }, MIN_TOUCH)
}

async function expectInViewport(page: Page, loc: Locator, what: string): Promise<void> {
  const box = await loc.boundingBox()
  const vp = page.viewportSize()!
  expect(box, `${what} has a box`).not.toBeNull()
  expect(box!.x, `${what} left`).toBeGreaterThanOrEqual(-0.5)
  expect(box!.y, `${what} top`).toBeGreaterThanOrEqual(-0.5)
  expect(box!.x + box!.width, `${what} right`).toBeLessThanOrEqual(vp.width + 0.5)
  expect(box!.y + box!.height, `${what} bottom`).toBeLessThanOrEqual(vp.height + 0.5)
}

async function noPageScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => ({ w: document.documentElement.scrollWidth - window.innerWidth, h: document.documentElement.scrollHeight - window.innerHeight }))
  expect(over.w, 'no horizontal page scroll').toBeLessThanOrEqual(1)
  expect(over.h, 'no vertical page scroll').toBeLessThanOrEqual(1)
}

test('phone: drawers, activation bar and shoot prompts fit the screen with 44 px targets', async ({ page }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page, '?scenario=shoot-cover&speed=instant')
  await page.waitForFunction(() => window.__ms!.settled())
  expect(await page.evaluate(() => document.documentElement.dataset.ff)).toBe('compact')
  await expect(page.getByTestId('rotate-prompt')).toHaveCount(0)
  await noPageScroll(page)

  // activate prompt
  const prompt = page.getByTestId('decision-prompt')
  await expectInViewport(page, prompt, 'activate prompt')
  await shot(page, info, 1)
  const problems: string[] = []
  problems.push(...(await smallTargets(page.getByTestId('battle'))).map((t) => `activate screen: ${t}`))

  // every drawer
  let n = 2
  for (const [btn, panel] of [
    ['btn-mission', 'mission-panel'],
    ['btn-feed', 'event-feed-panel'],
    ['btn-log', 'dice-log-panel'],
    ['btn-settings', 'settings-panel'],
  ] as const) {
    await page.getByTestId(btn).click()
    const drawer = page.getByTestId(panel)
    await expect(drawer).toBeVisible()
    await expectInViewport(page, drawer, panel)
    await shot(page, info, n++)
    problems.push(...(await smallTargets(drawer)).map((t) => `${panel}: ${t}`))
    await page.getByTestId(btn).click()
    await expect(drawer).toHaveCount(0)
  }

  // activation: order, then the action bar
  await page.getByTestId('activate-A6').click()
  await expect(page.getByTestId('order-engage')).toBeVisible()
  await expectInViewport(page, prompt, 'order prompt')
  await page.getByTestId('order-engage').click()
  await expect(page.getByTestId('act-shoot')).toBeVisible()
  await shot(page, info, n++)
  await expectInViewport(page, prompt, 'action bar')
  await page.getByTestId('act-shoot').scrollIntoViewIfNeeded()
  await expectInViewport(page, page.getByTestId('act-shoot'), 'Shoot button')
  await expectInViewport(page, page.getByTestId('act-end'), 'End activation button')
  problems.push(...(await smallTargets(prompt)).map((t) => `action bar: ${t}`))

  // shoot: weapon cards, then targets (a long list: the sheet scrolls, the footer and header stay on screen)
  await page.getByTestId('act-shoot').click()
  await expect(page.getByTestId('weapon-cards')).toBeVisible()
  await expectInViewport(page, prompt, 'weapon prompt')
  await shot(page, info, n++)
  problems.push(...(await smallTargets(prompt)).map((t) => `weapon prompt: ${t}`))
  await page.getByTestId('opt-aod.w.auto-bolt-rifle').click()
  await expect(page.getByTestId('target-cards')).toBeVisible()
  await expectInViewport(page, prompt, 'target prompt')
  await shot(page, info, n++)
  problems.push(...(await smallTargets(prompt)).map((t) => `target prompt: ${t}`))
  const first = page.getByTestId('opt-B2')
  await first.scrollIntoViewIfNeeded()
  await expect(first).toBeVisible()
  await expectInViewport(page, first, 'first target card')
  await noPageScroll(page)

  expect(problems, 'touch targets under 44 px').toEqual([])
  expect(errors).toEqual([])
})

test('phone: the rotate prompt covers a game held in portrait and the start screen stays usable', async ({ page }, info) => {
  const vp = page.viewportSize()!
  await page.setViewportSize({ width: vp.height, height: vp.width })
  await page.goto('./')
  await expect(page.getByTestId('start-screen')).toBeVisible()
  await expect(page.getByTestId('rotate-prompt')).toHaveCount(0)
  await page.setViewportSize(vp)
  await startBattle(page, '?scenario=fight&speed=instant')
  await page.setViewportSize({ width: vp.height, height: vp.width })
  await expect(page.getByTestId('rotate-prompt')).toBeVisible()
  await screenshotRendered(page, `e2e-out/mobile-${info.project.name}-rotate.png`, 1000)
  await page.setViewportSize(vp)
  await expect(page.getByTestId('rotate-prompt')).toHaveCount(0)
})

test('Home Screen install: the manifest and its icons are served', async ({ page, request }) => {
  await page.goto('./')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()
  const manifestUrl = new URL(href!, page.url()).toString()
  const res = await request.get(manifestUrl)
  expect(res.ok()).toBe(true)
  const manifest = (await res.json()) as { display: string; orientation: string; icons: { src: string; sizes: string; purpose?: string }[] }
  expect(manifest.orientation).toBe('landscape')
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
  for (const icon of manifest.icons) {
    const r = await request.get(new URL(icon.src, manifestUrl).toString())
    expect(r.ok(), icon.src).toBe(true)
  }
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
  expect((await request.get(new URL(touch!, page.url()).toString())).ok()).toBe(true)
})
