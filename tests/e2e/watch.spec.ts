// Watch AI vs AI: from the start screen, open a watched battle, check the watch bar, pause, step exactly one decision, switch to
// Instant and run to the end screen. Also the H key: it hides every panel and leaves the board, and brings them back.
// `?debug` installs window.__ms without skipping the menus (`?test=1` would start a battle at once).
import { expect, test, type Page } from '@playwright/test'
import { screenshotRendered } from './helpers'

interface Watch {
  paused: boolean
  reason: string | null
  answers: number
  deciding: string | null
  applied: boolean
}

const watch = (page: Page): Promise<Watch> => page.evaluate(() => (window as any).__ms.watch() as Watch)
const pendingId = (page: Page): Promise<string | null> => page.evaluate(() => (window as any).__ms.getPending()?.id ?? null)

/** Paused with the bot's answer to the current decision on the card, not yet applied. */
async function waitHeld(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ms = (window as any).__ms
    const w = ms.watch()
    return w.paused && w.deciding !== null && w.deciding === ms.getPending()?.id && !w.applied
  }, undefined, { timeout: 30_000 })
}

async function openWatch(page: Page, speed = 'normal'): Promise<void> {
  await page.goto(`./?debug&speed=${speed}`)
  await expect(page.getByTestId('start-screen')).toBeVisible()
  await page.getByTestId('watch-start').click()
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
  await expect(page.getByTestId('watch-bar')).toBeVisible()
}

test('watch: start screen entry, pause, step one decision, Instant to the end screen', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openWatch(page)

  // both seats are bots and the human prompt never shows
  expect(await page.evaluate(() => (window as any).__ms.session().seats)).toEqual({ A: 'bot', B: 'bot' })
  await expect(page.getByTestId('prompt')).toHaveCount(0)
  await expect(page.getByTestId('watch-speed-normal')).toHaveAttribute('aria-checked', 'true')

  // pause: no further answers while the card holds the decision
  await page.getByTestId('watch-play').click()
  await expect(page.getByTestId('watch-bar')).toHaveAttribute('data-paused', '1')
  await waitHeld(page)
  await expect(page.getByTestId('bot-card')).toBeVisible()
  const held = await watch(page)
  const heldId = await pendingId(page)
  await page.waitForTimeout(1200)
  expect((await watch(page)).answers).toBe(held.answers)
  expect(await pendingId(page)).toBe(heldId)

  // step: exactly one decision goes through, then the game holds again
  await page.getByTestId('watch-step').click()
  await page.waitForFunction((n) => (window as any).__ms.watch().answers === n, held.answers + 1)
  await waitHeld(page)
  await page.waitForTimeout(800)
  const after = await watch(page)
  expect(after.answers).toBe(held.answers + 1)
  expect(after.paused).toBe(true)
  expect(await pendingId(page)).not.toBe(heldId)

  // the keyboard: Space plays and pauses (one toggle per press, even with a button focused), N steps
  await page.keyboard.press('Space')
  await expect(page.getByTestId('watch-bar')).toHaveAttribute('data-paused', '0')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('watch-bar')).toHaveAttribute('data-paused', '1')
  await waitHeld(page)
  const n0 = (await watch(page)).answers
  await page.keyboard.press('n')
  await page.waitForFunction((n) => (window as any).__ms.watch().answers === n, n0 + 1)

  // Instant: no waiting; play to the end screen
  await page.getByTestId('watch-speed-instant').click()
  await expect(page.getByTestId('watch-speed-instant')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('watch-play').click()
  await expect(page.getByTestId('end-screen')).toBeVisible({ timeout: 150_000 })
  await expect(page.getByTestId('end-again')).toHaveText('Watch again')
  await expect(page.getByTestId('end-menu')).toHaveText('Back to start')
  expect(errors).toEqual([])

  // Watch again: same matchup, new seed, running again
  const seed = await page.evaluate(() => (window as any).__ms.session().seed as string)
  await page.getByTestId('end-again').click()
  await expect(page.getByTestId('watch-bar')).toBeVisible()
  expect(await page.evaluate(() => (window as any).__ms.session().seed as string)).not.toBe(seed)
  expect(await page.evaluate(() => (window as any).__ms.session().seats)).toEqual({ A: 'bot', B: 'bot' })
})

test('watch: pause on attacks holds the game at the start of a shot or a fight', async ({ page }) => {
  test.setTimeout(180_000)
  await openWatch(page, 'instant')
  await page.getByTestId('watch-attacks').click()
  await expect(page.getByTestId('watch-attacks')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('watch-bar')).toHaveAttribute('data-paused', '1', { timeout: 120_000 })
  await expect(page.getByTestId('watch-reason')).toBeVisible()
  const kind = await page.evaluate(() => (window as any).__ms.getPending().kind as string)
  expect(kind).toMatch(/^(shoot|fight)\./)
  await expect(page.getByTestId('bot-card')).toBeVisible()
})

test('watch: H hides every panel and leaves the board; H brings them back', async ({ page }) => {
  await openWatch(page)
  await page.getByTestId('watch-play').click() // hold the game so the panels stay as they are
  await expect(page.getByTestId('hud')).toBeVisible()
  await expect(page.getByTestId('watch-bar')).toBeVisible()
  await expect(page.getByTestId('event-feed')).toBeVisible()

  await page.keyboard.press('h')
  for (const id of ['hud', 'watch-bar', 'event-feed', 'bot-card']) await expect(page.getByTestId(id)).toBeHidden()
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByTestId('ui-toggle')).toBeVisible()
  // the shortcut still works for the watch bar's keys while hidden
  await page.keyboard.press('Space')
  expect((await watch(page)).paused).toBe(false)
  await page.keyboard.press('Space')
  expect((await watch(page)).paused).toBe(true)

  await page.keyboard.press('h')
  for (const id of ['hud', 'watch-bar', 'event-feed']) await expect(page.getByTestId(id)).toBeVisible()

  // the button does the same
  await page.getByTestId('ui-toggle').click()
  await expect(page.getByTestId('hud')).toBeHidden()
  await page.getByTestId('ui-toggle').click()
  await expect(page.getByTestId('hud')).toBeVisible()
})

test('human play: H hides the panels, a chip says it is your move, and the board still takes clicks', async ({ page }) => {
  await page.goto('./?test=1&seats=human,bot&seed=s5c&speed=instant&scenario=tunnel-skirmish&board=foundry-run')
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
  await expect(page.getByTestId('prompt')).toBeVisible({ timeout: 30_000 })
  await page.keyboard.press('h')
  await expect(page.getByTestId('prompt')).toBeHidden()
  await expect(page.getByTestId('hud')).toBeHidden()
  await expect(page.getByTestId('ui-chip')).toContainText('press H to show')
  await expect(page.locator('canvas')).toBeVisible()
  // the legal answer still goes through (the board click path is the same store action)
  const n = await page.evaluate(() => (window as any).__ms.getState().seq as number)
  await page.evaluate(() => (window as any).__ms.choose((window as any).__ms.getPending().options[0].id))
  await page.waitForFunction((s) => (window as any).__ms.getState().seq > s, n)
  await page.keyboard.press('h')
  await expect(page.getByTestId('hud')).toBeVisible()
  await expect(page.getByTestId('ui-chip')).toHaveCount(0)
})

test('watch: the decision card and the dice tray read together mid-attack', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await openWatch(page, 'instant') // race through the set-up, then slow down once the first attack holds the game
  await page.getByTestId('watch-attacks').click()
  await expect(page.getByTestId('watch-bar')).toHaveAttribute('data-paused', '1', { timeout: 150_000 })
  await page.getByTestId('watch-speed-normal').click()
  await waitHeld(page)
  // step through the sequence until the dice tray has a row on screen
  for (let i = 0; i < 12 && (await page.getByTestId('tray-row').count()) === 0; i++) {
    const w = await watch(page)
    await page.getByTestId('watch-step').click()
    await page.waitForFunction((n) => (window as any).__ms.watch().answers > n, w.answers)
    await page.waitForTimeout(2500)
  }
  await screenshotRendered(page, 'tools/out/watch-mode.png')
  expect(info.project.name).toBe('chromium')
})
