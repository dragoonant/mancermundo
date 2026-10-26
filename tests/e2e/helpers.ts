// Shared e2e helpers: open a battle through the test URL parameters (optionally fast-forwarded by a dev fixture), wait for the
// presentation to settle, and take a screenshot only once the demand-driven canvas has actually been drawn.
import { expect, type Locator, type Page } from '@playwright/test'

/** The default test battle: human seat A against the bot on the Tunnel Skirmish, Foundry Run, no animation delays. */
export const TEST_QUERY = '?test=1&seats=human,bot&seed=s5c&speed=instant&scenario=tunnel-skirmish&board=foundry-run'

export async function startBattle(page: Page, query = TEST_QUERY): Promise<void> {
  await page.goto(`./${query}`)
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
  await page.waitForFunction(() => !!window.__ms?.getState())
}

export interface Pending {
  id: string
  seat: 'A' | 'B'
  kind: string
  canPass: boolean
  options?: { id: string; data?: Record<string, unknown>; action: { type: string; payload: Record<string, unknown> } }[]
  context: Record<string, unknown>
}

export async function pending(page: Page): Promise<Pending | null> {
  return page.evaluate(() => (window.__ms?.getPending() as Pending | null) ?? null)
}

/** Screenshot that waits for the board to be drawn: the canvas uses a demand-driven frame loop, so a shot taken right after a
 *  layout change can catch a cleared canvas. Nudges a repaint, lets two animation frames pass and retries when the PNG is
 *  implausibly small for a 3D scene. */
export async function screenshotRendered(page: Page, path: string, minBytes = 60_000): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      window.__ms?.camera.current?.repaint()
      return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    })
    await page.waitForTimeout(250 + i * 250)
    const buf = await page.screenshot({ path })
    if (buf.length >= minBytes) return
  }
}

export async function noHorizontalScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(1)
}

/** Visible buttons (and button-like links) whose box is under `min` px, as text. */
export async function smallTargets(scope: Locator, min = 44): Promise<string[]> {
  return scope.evaluate((root, m) => {
    const out: string[] = []
    for (const b of Array.from(root.querySelectorAll('button, [role="button"], a[href], input, select'))) {
      const hit = b instanceof HTMLInputElement && (b.type === 'checkbox' || b.type === 'radio') ? (b.closest('label') ?? b) : b
      const r = hit.getBoundingClientRect()
      const cs = getComputedStyle(b)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue
      if (r.height < m - 0.5) out.push(`${(b.textContent || b.getAttribute('aria-label') || b.getAttribute('data-testid') || b.tagName).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    return out
  }, min)
}

export async function expectInViewport(page: Page, loc: Locator, what: string): Promise<void> {
  const box = await loc.boundingBox()
  const vp = page.viewportSize()!
  expect(box, `${what} has a box`).not.toBeNull()
  expect(box!.x, `${what} left`).toBeGreaterThanOrEqual(-0.5)
  expect(box!.y, `${what} top`).toBeGreaterThanOrEqual(-0.5)
  expect(box!.x + box!.width, `${what} right`).toBeLessThanOrEqual(vp.width + 0.5)
  expect(box!.y + box!.height, `${what} bottom`).toBeLessThanOrEqual(vp.height + 0.5)
}
