// Phone layout smoke (S5c). Runs on the three mobile projects (iphone-se, iphone-pro, pixel; landscape). The start screen, gang picker
// and briefing fit the screen with 44 px targets and no sideways scroll; in a battle the shoot prompt (with its odds) fits, and the
// fighter card opens as a sheet that fits. Screenshots land in tools/out/s5c-phone-<project>-*.png.
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { expectInViewport, noHorizontalScroll, pending, screenshotRendered, smallTargets, startBattle, TEST_QUERY } from './helpers'

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: `tools/out/s5c-phone-${info.project.name}-${name}.png` })
}

test('phone: start screen, gang picker and briefing fit with 44 px targets', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./')
  await expect(page.getByTestId('title')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.ff)).toBe('compact')
  await noHorizontalScroll(page)
  expect(await smallTargets(page.getByTestId('start-screen')), 'start screen targets under 44 px').toEqual([])
  await shot(page, info, 'start')

  await page.getByTestId('choose-gangs').click()
  await expect(page.getByTestId('gang-picker')).toBeVisible()
  await noHorizontalScroll(page)
  expect(await smallTargets(page.getByTestId('gang-picker')), 'gang picker targets under 44 px').toEqual([])
  await shot(page, info, 'gangs')
  await page.getByTestId('gangs-done').click()

  await page.getByTestId('to-briefing').click()
  await expect(page.getByTestId('briefing-rounds').locator('li')).toHaveCount(5)
  await noHorizontalScroll(page)
  expect(await smallTargets(page.getByTestId('briefing')), 'briefing targets under 44 px').toEqual([])
  await shot(page, info, 'briefing')
  expect(errors).toEqual([])
})

test('phone: the shoot prompt with odds and the fighter card sheet fit the screen', async ({ page }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page, `${TEST_QUERY}&fixture=shoot`)
  await page.waitForFunction(() => window.__ms!.settled())
  expect(await page.evaluate(() => document.documentElement.dataset.ff)).toBe('compact')
  await expect(page.getByTestId('rotate-prompt')).toHaveCount(0)
  await noHorizontalScroll(page)
  const p = await pending(page)
  test.skip(!p || p.kind !== 'shoot.target', 'the shoot fixture could not reach a target (engine part missing)')
  const prompt = page.getByTestId('prompt')
  await expectInViewport(page, prompt, 'shoot prompt')
  await expect(prompt.getByTestId('odds-hit').first()).toBeVisible()
  expect(await smallTargets(prompt), 'prompt targets under 44 px').toEqual([])
  await screenshotRendered(page, `tools/out/s5c-phone-${info.project.name}-shoot.png`, 20_000)

  // the fighter card is a button on a phone and opens as a sheet that fits the screen
  const open = page.getByTestId('fighter-card-open')
  await expect(open).toBeVisible()
  await open.click()
  const card = page.getByTestId('fighter-card')
  await expect(card.locator('[data-stat]')).toHaveCount(12)
  await expectInViewport(page, card, 'fighter card sheet')
  await shot(page, info, 'card')
  await page.getByTestId('fighter-sheet-close').click()
  await expect(card).toHaveCount(0)
  expect(errors).toEqual([])
})

test('phone: the end screen fits and its buttons are 44 px', async ({ page }, info) => {
  test.setTimeout(120_000)
  await startBattle(page, `${TEST_QUERY}&fixture=end`)
  const end = page.getByTestId('end-screen')
  await expect(end).toBeVisible({ timeout: 30_000 })
  await expectInViewport(page, page.getByTestId('result'), 'result panel')
  expect(await smallTargets(end), 'end screen targets under 44 px').toEqual([])
  await shot(page, info, 'end')
})
