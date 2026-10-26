// Scenario fixture `fight`: an Assault Intercessor Warrior in control range of a Boy and the Boss Nob.
import { expect, test } from '@playwright/test'
import { screenshotRendered, startBattle } from './helpers'

test('fight: target cards with wounds and distance, then the weapon and the strike-or-block prompt', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page, '?scenario=fight&speed=instant')
  await page.waitForFunction(() => window.__ms!.settled())
  await page.getByTestId('activate-A3').click()
  await page.getByTestId('order-engage').click()
  // Shoot is restricted in an enemy control range; Fight is offered
  await expect(page.getByTestId('act-shoot')).toBeDisabled()
  await page.getByTestId('act-fight').click()
  const targets = page.getByTestId('fight-target-cards')
  await expect(targets).toBeVisible()
  await expect(targets.locator('button')).toHaveCount(2)
  await expect(targets).toContainText('Boss Nob')
  await expect(targets).toContainText(/\d+\/\d+ wounds left/)
  await expect(targets).toContainText(/\d\.\d″ away/)
  await screenshotRendered(page, 'e2e-out/scenario-fight.png')
  await targets.locator('button').filter({ hasText: 'Boy' }).click()
  await expect(page.getByTestId('decision-prompt')).toBeVisible()
  expect(errors).toEqual([])
})
