// Scenario fixture `vantage`: a shooter on the large ruin's upper floor, 3 inches above the target: Accurate 1.
import { expect, test } from '@playwright/test'
import { screenshotRendered, startBattle } from './helpers'

test('vantage: the target card notes the Accurate bonus and the odds include it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page, '?scenario=vantage&speed=instant')
  await page.waitForFunction(() => window.__ms!.settled())
  const state = await page.evaluate(() => window.__ms!.getState() as { operatives: Record<string, { pos: { y: number } }> })
  expect(state.operatives.A6!.pos.y).toBe(3)
  await page.getByTestId('activate-A6').click()
  await page.getByTestId('order-engage').click()
  await page.getByTestId('act-shoot').click()
  await page.getByTestId('opt-aod.w.auto-bolt-rifle').click()
  const card = page.getByTestId('opt-B2')
  await expect(card).toContainText('Boy')
  await expect(card.getByTestId('target-line')).toContainText('Vantage: Accurate 1')
  await expect(card.getByTestId('target-line')).toContainText(/expected damage \d+\.\d/)
  // the engine's own number: Vantage gives Accurate only against an Engage target, so the Concealed Grot gets no note
  const grot = page.getByTestId('opt-B11')
  await expect(grot).toContainText('Grot')
  await expect(grot.getByTestId('target-line')).not.toContainText('Vantage')
  await screenshotRendered(page, 'e2e-out/scenario-vantage.png')
  expect(errors).toEqual([])
})
