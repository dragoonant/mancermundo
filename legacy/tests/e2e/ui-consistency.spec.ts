// UI consistency: action hover help states cost and restrictions, prompts say why they matter, the feed groups dice
// batches, and the end screen offers Play again (same settings) and Swap seats.
import { expect, test } from '@playwright/test'
import { screenshotRendered, startBattle, TEST_QUERY } from './helpers'

test('action bar hover help, why-it-matters line and no native tooltips', async ({ page }) => {
  await startBattle(page, '?scenario=shoot-cover&speed=instant')
  await page.waitForFunction(() => window.__ms!.settled())
  await page.getByTestId('activate-A6').click()
  await page.getByTestId('order-engage').click()
  await page.getByTestId('act-shoot').hover()
  const tip = page.locator('[role="tooltip"]')
  await expect(tip).toContainText('Shoot · 1 AP')
  await expect(tip).toContainText('Costs 1 AP')
  await page.getByTestId('act-fallBack').hover({ force: true })
  await expect(tip).toContainText('Unavailable')
  expect(await page.locator('[title]').count()).toBe(0)
  await page.getByTestId('act-shoot').click()
  await page.getByTestId('opt-aod.w.auto-bolt-rifle').click()
  await expect(page.getByTestId('prompt-why')).toContainText('Why it matters')
  await expect(page.getByTestId('prompt-title')).toContainText('Choose a target')
})

test('end screen: Play again (same settings) and Swap seats', async ({ page }) => {
  await startBattle(page, TEST_QUERY)
  await page.waitForFunction(() => window.__ms!.settled())
  await page.evaluate(() => {
    const ms = window.__ms!
    const p = ms.getPending() as { seat: 'A' | 'B'; id: string }
    ms.dispatch({ type: 'resign', seat: p.seat, decisionId: p.id, payload: {} })
  })
  await expect(page.getByTestId('end-screen')).toBeVisible()
  await expect(page.getByTestId('end-again')).toHaveText('Play again (same settings)')
  await screenshotRendered(page, 'e2e-out/end-screen.png', 1000)
  await page.getByTestId('end-swap').click()
  await expect(page.getByTestId('end-screen')).toHaveCount(0)
  await page.waitForFunction(() => (window.__ms!.getState() as { phase: string } | null)?.phase !== 'ended')
  const seats = await page.evaluate(() => ({ s: (window.__ms!.session() as { seats: Record<string, string> }).seats, a: (window.__ms!.getState() as { players: { A: { teamId: string } } }).players.A.teamId }))
  expect(seats.s).toEqual({ A: 'bot', B: 'human' })
  expect(seats.a).toBe('kommandos')
})
