// The gang picker (S5c): the four starter gangs with fighters, costs and weapons; pick one per seat; a full fighter card with the
// weapon profiles and traits; keyword help in the shared tooltip.
import { expect, test } from '@playwright/test'
import { noHorizontalScroll } from './helpers'

test('gang picker: four gangs, rosters with costs and weapons, a pick per seat', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./?debug')
  await page.waitForFunction(() => !!window.__ms)
  await page.getByTestId('choose-gangs').click()
  await expect(page.getByTestId('gang-picker')).toBeVisible()
  const cards = page.locator('[data-testid^="gang-gol."], [data-testid^="gang-esc."]')
  await expect(cards).toHaveCount(4)
  await expect(cards.filter({ hasText: 'Furnace Crew' })).toContainText('credits')
  // the roster of the chosen gang: every fighter with a cost and its weapons
  const roster = page.getByTestId('gang-roster')
  await expect(roster).toContainText('Forge Tyrant')
  await expect(roster).toContainText('cr')
  await expect(roster).toContainText('Chainaxe')
  // seat A takes Furnace Crew by default; seat B gets the Wyld Skirmishers
  await page.getByTestId('seat-tab-B').click()
  await page.getByTestId('gang-esc.sg.starter-2').click()
  await expect(page.getByTestId('gang-roster')).toContainText('Wyld Skirmishers')
  await expect(page.getByTestId('gang-roster')).toContainText('Wyld bow')
  const picked = await page.evaluate(() => (window.__ms!.session() as { builds: Record<string, { starterId: string }> }).builds)
  expect(picked.B.starterId).toBe('esc.sg.starter-2')
  expect(picked.A.starterId).toBe('gol.sg.starter-1')

  // a fighter card: the twelve characteristics and the full weapon profile
  await page.getByTestId('seat-tab-A').click()
  await page.locator('[data-testid^="roster-card-gol.sg.starter-1:Forge Tyrant"]').click()
  const open = page.getByTestId('roster-open-card')
  await expect(open.locator('[data-stat]')).toHaveCount(12)
  await expect(open.getByTestId('weapon-table')).toContainText('Chainaxe')
  await expect(open.getByTestId('weapon-table')).toContainText('Rending')
  // trait help appears in the shared tooltip, never a native one
  await open.locator('[data-keyword="Rending"]').first().hover()
  await expect(page.locator('[role="tooltip"]')).toContainText('natural 6')
  expect(await page.locator('[title]').count()).toBe(0)
  await noHorizontalScroll(page)
  await page.screenshot({ path: 'tools/out/s5c-gang-picker.png' })

  await page.getByTestId('gangs-done').click()
  await expect(page.getByTestId('start-screen')).toBeVisible()
  await expect(page.getByTestId('seat-B')).toContainText('Wyld Skirmishers')
  expect(errors).toEqual([])
})
