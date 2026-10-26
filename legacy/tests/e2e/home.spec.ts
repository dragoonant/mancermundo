import { expect, test } from '@playwright/test'

test('home loads', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('title')).toContainText('Mancermundo')
  await page.screenshot({ path: 'e2e-out/home.png' })
})
