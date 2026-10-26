// Start screen options (bot level, animation speed, floor mat, How to play) persist, and the team builder's
// Randomise loadouts keeps both rosters legal.
import { expect, test } from '@playwright/test'

test('start screen options persist across a reload', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('bot-tier-normal')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('bot-tier-easy').click()
  await page.getByTestId('anim-fast').click()
  await page.getByTestId('mat-rust-grating').click()
  expect(await page.evaluate(() => localStorage.getItem('ms.botTier'))).toBe('easy')
  expect(await page.evaluate(() => localStorage.getItem('ms.mat'))).toBe('rust-grating')
  await page.reload()
  await expect(page.getByTestId('bot-tier-easy')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('anim-fast')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('mat-rust-grating')).toHaveAttribute('aria-checked', 'true')
  // every mat tile shows its thumbnail
  for (const id of ['plasteel-deck', 'rust-grating', 'cracked-concrete', 'ash-waste', 'gothic-flagstones', 'blood-foundry']) {
    await expect(page.getByTestId(`mat-${id}`)).toBeVisible()
  }
  await expect(page.getByTestId('mat-random')).toBeVisible()
  await page.screenshot({ path: 'e2e-out/start-options.png' })
})

test('How to play opens the briefing at the controls and Back returns to the start screen', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('how-to-play').click()
  await expect(page.getByTestId('briefing')).toBeVisible()
  await expect(page.getByTestId('briefing-controls')).toBeInViewport()
  await page.getByTestId('briefing-back').click()
  await expect(page.getByTestId('start-screen')).toBeVisible()
})

test('Randomise loadouts keeps the roster legal and shows what each operative carries', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('team-A').selectOption('angels-of-death')
  await page.getByTestId('go-builder').click()
  await expect(page.getByTestId('builder-ok')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('builder-carrying')).toContainText('Carrying:')
  for (let i = 0; i < 4; i++) {
    await page.getByTestId('builder-randomise').click()
    await expect(page.getByTestId('builder-ok')).toBeVisible()
    await expect(page.getByTestId('builder-problems')).toHaveCount(0)
  }
  await expect(page.getByTestId('pick-kit-main-0')).not.toBeEmpty()
})
