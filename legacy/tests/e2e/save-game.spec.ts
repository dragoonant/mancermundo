// Save game: play a few actions into turning point 1 against the bot, reload the page, the Start screen offers
// Continue, and Continue reopens the same turning point, phase and operative positions.
import { expect, test, type Page } from '@playwright/test'
import { snapshot, startBattle, type E2eState } from './helpers'

/** Answer the human seat with the random bot's choice until turning point 1 plus a few more actions. */
async function playIntoTurningPoint1(page: Page): Promise<void> {
  const t0 = Date.now()
  let extra = -1
  while (Date.now() - t0 < 120_000) {
    const s = await page.evaluate(() => {
      const st = window.__ms!.getState() as { turningPoint: number; phase: string }
      const p = window.__ms!.getPending() as { seat: string } | null
      return { tp: st.turningPoint, phase: st.phase, seat: p?.seat ?? null, settled: window.__ms!.settled() }
    })
    if (s.phase === 'ended') throw new Error('game ended early')
    if (s.tp >= 1 && extra >= 3 && s.seat === 'A' && s.settled) return
    if (s.seat === 'A' && s.settled) {
      const ok = await page.evaluate(() => window.__ms!.autoStep())
      if (ok && s.tp >= 1) extra++
    } else {
      await page.waitForTimeout(40)
    }
  }
  throw new Error('did not reach turning point 1 in time')
}

const positions = (s: E2eState) => s.ops.map((o) => `${o.id}:${o.status}:${o.pos.x.toFixed(3)},${o.pos.y.toFixed(3)},${o.pos.z.toFixed(3)}:${o.wounds}`).sort()

test('Continue reopens a saved game at the same turning point, phase and positions', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page)
  await playIntoTurningPoint1(page)
  const before = await snapshot(page)
  expect(before.tp).toBeGreaterThanOrEqual(1)

  // reload on the plain Start screen (no ?test=1, so nothing starts by itself); ?debug only installs the test hooks
  await page.goto('./?debug&speed=instant')
  await expect(page.getByTestId('start-screen')).toBeVisible()
  const card = page.getByTestId('continue-card')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('continue-teams')).toContainText('Angels of Death')
  await expect(page.getByTestId('continue-teams')).toContainText('Kommandos')
  await expect(page.getByTestId('continue-progress')).toContainText(/Turning point \d, (Strategy|Firefight) phase/)
  await expect(page.getByTestId('continue-progress')).toContainText('vs bot')
  await expect(page.getByTestId('continue-when')).toHaveText('just now')
  await page.screenshot({ path: 'test-results/save/continue-card.png' })

  await page.getByTestId('continue-game').click()
  await page.getByTestId('battle').waitFor()
  await page.waitForFunction(() => !!window.__ms?.getState())
  await expect(page.getByTestId('hud')).toBeVisible()
  // the board opens at once: nothing queued to play, no banner
  await page.waitForFunction(() => window.__ms!.settled())
  const after = await snapshot(page)
  expect(after.tp).toBe(before.tp)
  expect(after.phase).toBe(before.phase)
  expect(after.seq).toBeGreaterThanOrEqual(before.seq) // the bot may already have answered if it was its turn
  if (after.seq === before.seq) expect(positions(after)).toEqual(positions(before))
  else expect(after.ops.length).toBe(before.ops.length)
  expect(await page.evaluate(() => window.__ms!.events().length)).toBeLessThan(40) // the earlier battle was not replayed into the feed
  await expect(page.getByTestId('hud-phase')).toBeVisible()
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__ms?.camera.current?.repaint())
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/save/resumed.png' })

  // Quit to menu keeps the game; Abandon deletes it
  if (!(await page.getByTestId('settings-panel').isVisible())) await page.getByTestId('btn-settings').click()
  await page.getByTestId('btn-menu').click()
  await expect(page.getByTestId('continue-card')).toBeVisible()
  await page.getByTestId('continue-game').click()
  await page.getByTestId('battle').waitFor()
  // the menu drawer stays open across screens: open it only if it is closed
  if (!(await page.getByTestId('settings-panel').isVisible())) await page.getByTestId('btn-settings').click()
  await page.getByTestId('btn-abandon').click()
  await page.getByTestId('btn-abandon-confirm').click()
  await expect(page.getByTestId('start-screen')).toBeVisible()
  await expect(page.getByTestId('continue-card')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('ms.save'))).toBeNull()
  expect(errors).toEqual([])
})

test('a save from an older version is dropped with a message and the Start screen still works', async ({ page }) => {
  await page.goto('./')
  await page.evaluate(() => localStorage.setItem('ms.save', JSON.stringify({ kind: 'mancermundo-save', v: 0, savedAt: 1 })))
  await page.reload()
  await expect(page.getByTestId('save-notice')).toContainText(/older version/)
  await expect(page.getByTestId('continue-card')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('ms.save'))).toBeNull()
  await page.getByTestId('quick-start').click()
  await expect(page.getByTestId('briefing')).toBeVisible()
})
