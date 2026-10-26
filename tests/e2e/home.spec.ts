// The start flow (S5c): title and underhive start screen, the setup choices (opponent, seat, scenario, board), the briefing for the
// chosen scenario, hotseat, and a battle that starts from the briefing. Screenshots land in tools/out/s5c-*.png.
import { expect, test } from '@playwright/test'
import { noHorizontalScroll, screenshotRendered } from './helpers'

test('home: the title, the setup choices and no horizontal scroll', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./')
  await expect(page.getByTestId('title')).toContainText('Mancermundo')
  await expect(page.getByTestId('opponent-bot')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('human-seat-A')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('scenario-tunnel-skirmish')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('seat-A')).toContainText('credits')
  await expect(page.getByTestId('seat-B')).toContainText('fighters')
  // all three scenarios are playable since S4 (Forgotten Riches had been greyed out before tile deployment existed)
  await expect(page.getByTestId('scenario-forgotten-riches')).toBeEnabled()
  expect(await page.locator('[title]').count(), 'no native tooltips').toBe(0)
  await noHorizontalScroll(page)
  await page.screenshot({ path: 'tools/out/s5c-start.png', fullPage: false })
  expect(errors).toEqual([])
})

test('home: opponent and seat choices change who plays what', async ({ page }) => {
  await page.goto('./?debug')
  await page.waitForFunction(() => !!window.__ms)
  const seats = () => page.evaluate(() => (window.__ms!.session() as { seats: Record<string, string> }).seats)
  expect(await seats()).toEqual({ A: 'human', B: 'bot' })
  await page.getByTestId('human-seat-B').click()
  expect(await seats()).toEqual({ A: 'bot', B: 'human' })
  await page.getByTestId('opponent-hotseat').click()
  expect(await seats()).toEqual({ A: 'human', B: 'human' })
  await expect(page.getByTestId('human-seat')).toHaveCount(0)
  await expect(page.getByTestId('seat-B')).toContainText('player B')
})

test('briefing: objective, how to win and the round in five lines, then Deploy opens the battle', async ({ page }) => {
  await page.goto('./?debug')
  await page.getByTestId('scenario-tunnel-skirmish').click()
  await page.getByTestId('to-briefing').click()
  await expect(page.getByTestId('briefing-title')).toHaveText('Tunnel Skirmish')
  await expect(page.getByTestId('briefing-win')).toContainText('points')
  await expect(page.getByTestId('briefing-rounds').locator('li')).toHaveCount(5)
  await expect(page.getByTestId('briefing-gangs')).toContainText('Gang A')
  await noHorizontalScroll(page)
  await page.screenshot({ path: 'tools/out/s5c-briefing.png' })
  // a keyword in the briefing explains itself in the shared tooltip
  await page.getByTestId('briefing-rounds').locator('[data-keyword]').first().hover()
  await expect(page.locator('[role="tooltip"]')).toBeVisible()
  await page.getByTestId('briefing-back').click()
  await expect(page.getByTestId('start-screen')).toBeVisible()
  await page.getByTestId('to-briefing').click()
  await page.getByTestId('briefing-start').click()
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
  await screenshotRendered(page, 'tools/out/s5c-battle-start.png', 30_000)
})

test('smash & grab: its briefing names the crates and who may crack them', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('scenario-smash-and-grab').click()
  await page.getByTestId('to-briefing').click()
  await expect(page.getByTestId('briefing-title')).toHaveText('Smash & Grab')
  await expect(page.getByTestId('briefing-body')).toContainText('crate')
  await expect(page.getByTestId('briefing-win')).toContainText('three')
})
