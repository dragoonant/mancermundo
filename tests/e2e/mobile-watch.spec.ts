// Phone layout of the watch mode (runs on the mobile projects with the other mobile-*.spec.ts files): the Watch entry on the start
// screen, the watch bar, the decision card and the show/hide button fit the screen with 44 px targets and no sideways scroll.
import { expect, test } from '@playwright/test'
import { expectInViewport, noHorizontalScroll, smallTargets } from './helpers'

test('phone: the watch entry, the watch bar and the show/hide button fit with 44 px targets', async ({ page }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./?debug&speed=instant')
  await expect(page.getByTestId('start-screen')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.ff)).toBe('compact')
  await page.getByTestId('watch-setup').scrollIntoViewIfNeeded()
  await noHorizontalScroll(page)
  expect(await smallTargets(page.getByTestId('watch-setup')), 'watch set-up targets under 44 px').toEqual([])

  await page.getByTestId('watch-start').click()
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
  const bar = page.getByTestId('watch-bar')
  await expect(bar).toBeVisible()
  await page.getByTestId('watch-play').click()
  await expect(bar).toHaveAttribute('data-paused', '1')
  await page.waitForFunction(() => {
    const ms = (window as any).__ms
    const w = ms.watch()
    return w.deciding !== null && w.deciding === ms.getPending()?.id
  })
  await expectInViewport(page, bar, 'watch bar')
  expect(await smallTargets(bar), 'watch bar targets under 44 px').toEqual([])
  await expect(page.getByTestId('bot-card')).toBeVisible()
  await expectInViewport(page, page.getByTestId('bot-card'), 'decision card')
  const toggle = page.getByTestId('ui-toggle')
  await expectInViewport(page, toggle, 'show/hide button')
  const box = await toggle.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(43.5)
  expect(box!.height).toBeGreaterThanOrEqual(43.5)
  await noHorizontalScroll(page)
  await page.screenshot({ path: `tools/out/watch-phone-${info.project.name}.png` })

  await toggle.click()
  await expect(bar).toBeHidden()
  await expect(toggle).toBeVisible()
  expect(errors).toEqual([])
})
