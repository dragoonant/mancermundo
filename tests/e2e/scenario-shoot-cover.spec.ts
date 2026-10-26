// Scenario fixture `shoot-cover`: an Intercessor Gunner with a Boy in light cover, a Grot in the open and a Concealed
// Breacha Boy hiding behind the rubble. The shoot prompts must show the engine's expected damage, the cover badge and
// the reason the hidden one cannot be chosen.
import { expect, test } from '@playwright/test'
import { screenshotRendered, startBattle } from './helpers'

test('shoot-cover: weapon odds, cover badge, clear shot and the hidden target', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page, '?scenario=shoot-cover&speed=instant')
  await page.waitForFunction(() => window.__ms!.settled())
  await page.getByTestId('activate-A6').click()
  await page.getByTestId('order-engage').click()
  await page.getByTestId('act-shoot').click()

  // weapon step: every profile shows its stats and the engine's expected damage against the best target
  await expect(page.getByTestId('weapon-cards')).toBeVisible()
  await expect(page.getByTestId('weapon-odds').first()).toContainText(/expected damage \d+\.\d/)
  await page.getByTestId('opt-aod.w.auto-bolt-rifle').click()

  // target step
  const cards = page.getByTestId('target-cards')
  await expect(cards).toBeVisible()
  const cover = cards.getByTestId('opt-B2')
  await expect(cover).toHaveAttribute('data-verdict', 'cover')
  await expect(cover).toContainText('Boy')
  await expect(cover).toContainText('in cover')
  await expect(cover.getByTestId('target-line')).toContainText(/expected damage \d+\.\d · kill \d+%/)
  const clear = cards.getByTestId('opt-B11')
  await expect(clear).toHaveAttribute('data-verdict', 'valid')
  await expect(clear).toContainText('Grot')
  await expect(clear).toContainText('clear shot')
  await expect(clear.getByTestId('target-line')).toContainText(/expected damage/)
  // the Concealed Breacha Boy in cover is listed as not selectable, with the engine's reason
  const hidden = page.getByTestId('unlisted-B3')
  await expect(hidden).toContainText('Breacha Boy')
  await expect(hidden).toContainText('not visible')
  await screenshotRendered(page, 'e2e-out/scenario-shoot-cover.png')
  expect(errors).toEqual([])
})
