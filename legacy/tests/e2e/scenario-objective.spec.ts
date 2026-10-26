// Scenario fixture `objective-contest`: both seats inside the centre objective's control range.
import { expect, test } from '@playwright/test'
import { screenshotRendered, startBattle } from './helpers'

test('objective-contest: the mission panel shows who controls the marker and the contesting counts', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page, '?scenario=objective-contest&speed=instant')
  await page.waitForFunction(() => window.__ms!.settled())
  const markers = page.getByTestId('mission-markers')
  if (!(await markers.isVisible())) await page.getByTestId('btn-mission').click()
  await expect(markers).toContainText('controls (2 vs 1 contesting)')
  await expect(markers).toContainText('uncontrolled')
  await screenshotRendered(page, 'e2e-out/scenario-objective.png')
  expect(errors).toEqual([])
})
