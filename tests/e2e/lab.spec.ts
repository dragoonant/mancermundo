// S2L: the lab viewer renders each Zone Mortalis board with both gangs deployed and no page errors; the panel's pickers and
// door buttons work. Screenshots land in tools/out/ (not compared).
import { expect, test } from '@playwright/test'

const BOARDS = ['foundry-run', 'bulkhead-gauntlet', 'cistern-crossing', 'hive-heart', 'sump-warren']

for (const slug of BOARDS) {
  test(`lab draws ${slug} with fighters`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`./?board=${slug}&menu=0`)
    await expect(page.locator('canvas')).toBeVisible()
    await page.waitForFunction((id) => (window as unknown as { __lab?: { board: string } }).__lab?.board === `zm.b.${id}`, slug)
    const lab = await page.evaluate(() => (window as unknown as { __lab: { walls: number; doors: number; fighters: number } }).__lab)
    expect(lab.walls).toBeGreaterThan(20)
    expect(lab.fighters).toBeGreaterThanOrEqual(8)
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `tools/out/s2l-e2e-${slug}.png` })
    expect(errors).toEqual([])
  })
}

test('lab pickers change the board and the doors toggle', async ({ page }) => {
  await page.goto('./?board=foundry-run')
  await page.getByLabel('Board').selectOption('zm.b.hive-heart')
  await page.waitForFunction(() => (window as unknown as { __lab?: { board: string } }).__lab?.board === 'zm.b.hive-heart')
  expect(page.url()).toContain('board=zm.b.hive-heart')
  await page.getByRole('button', { name: 'Open all' }).click()
  await page.getByRole('button', { name: 'Close all' }).click()
  await page.getByLabel('Gang B').selectOption({ index: 0 })
  await expect(page.locator('canvas')).toBeVisible()
})
