// Team builder: slots follow the team's selection rules, illegal picks are disabled with a reason, loadout sets
// switch the options shown, equipment stops at the mission limit, and a legal roster continues to the battle.
import { expect, test } from '@playwright/test'
import { screenshotRendered } from './helpers'

test('team builder enforces the selection rules and starts a battle', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./')
  await expect(page.getByTestId('title')).toContainText('Mancermundo')
  await page.getByTestId('team-A').selectOption('angels-of-death')
  await page.getByTestId('team-B').selectOption('kommandos')
  await page.getByTestId('go-builder').click()
  // the builder (and its three.js preview) is a lazy chunk: allow for a cold, busy machine
  await expect(page.getByTestId('team-builder')).toBeVisible({ timeout: 30_000 })

  // default roster is legal: leader 1/1, operatives 5/5
  await expect(page.getByTestId('slot-count-leader')).toHaveText('1/1')
  await expect(page.getByTestId('slot-count-main')).toHaveText('5/5')
  await expect(page.getByTestId('builder-ok')).toBeVisible()

  // a full slot disables every add with the reason
  const add = page.getByTestId('add-aod.intercessor-gunner')
  await expect(add).toBeDisabled()

  // remove one operative: the slot is short, the roster is illegal, continue is disabled
  await page.getByTestId('remove-main-4').click()
  await expect(page.getByTestId('slot-count-main')).toHaveText('4/5')
  await expect(page.getByTestId('builder-problems')).toContainText('4 selections chosen, 5 required')
  await expect(page.getByTestId('builder-continue')).toBeDisabled()

  // a once-only operative that is already taken stays disabled; a free one can be added back
  await expect(page.getByTestId('add-aod.eliminator-sniper')).toBeDisabled()
  await page.getByTestId('add-aod.intercessor-warrior').click()
  await expect(page.getByTestId('slot-count-main')).toHaveText('5/5')
  await expect(page.getByTestId('builder-ok')).toBeVisible()

  // loadout sets: the leader has two kits; switching shows different options
  await page.getByTestId('pick-row-leader-0').click()
  await expect(page.getByTestId('builder-loadout')).toContainText('Sergeant kit')
  await page.getByTestId('set-plasma-and-chainsword').click()
  await expect(page.getByTestId('loadout-slot-pistol')).toHaveCount(0)
  await page.getByTestId('set-pistol-and-melee').click()
  await expect(page.getByTestId('loadout-slot-pistol')).toBeVisible()

  // a one-weapon slot swaps on pick; the 3D preview is mounted
  await page.getByTestId('pick-row-main-4').click()
  await expect(page.getByTestId('builder-preview')).toBeVisible()
  await expect(page.getByTestId('builder-preview').locator('canvas')).toHaveCount(1)

  // equipment stops at the mission limit with a reason (the default roster already carries four picks: clear them first)
  const boxes = page.locator('input[type=checkbox][data-testid^="equip-"]')
  expect(await boxes.count()).toBeGreaterThan(4)
  const ticked = page.locator('input[type=checkbox][data-testid^="equip-"]:checked')
  while ((await ticked.count()) > 0) await ticked.first().uncheck()
  await expect(page.getByTestId('equipment-count')).toHaveText('0/4')
  for (let i = 0; i < 4; i++) await page.locator('input[type=checkbox][data-testid^="equip-"]:not(:checked):not([disabled])').first().check()
  await expect(page.getByTestId('equipment-count')).toHaveText('4/4')
  await expect(page.locator('input[type=checkbox][data-testid^="equip-"]:not(:checked)').first()).toBeDisabled()
  await page.waitForTimeout(600)
  await screenshotRendered(page, 'e2e-out/team-builder-01.png', 20_000)

  // continue to the briefing, then deploy into the battle
  await page.getByTestId('builder-continue').click()
  await expect(page.getByTestId('briefing')).toBeVisible()
  await expect(page.getByTestId('briefing-title')).toContainText('Preliminary Ops')
  await page.getByTestId('briefing-start').click()
  await expect(page.getByTestId('battle')).toBeVisible()
  await expect(page.getByTestId('hud-tp')).toBeVisible()
  expect(errors).toEqual([])
})
