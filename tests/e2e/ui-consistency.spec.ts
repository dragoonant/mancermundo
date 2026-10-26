// UI consistency (S5c): the shoot prompt names what it decides and shows the engine's odds, the fighter card has all twelve
// characteristics, keyword help comes from the shared tooltip, the HUD shows round / phase / Priority, and the end screen offers the
// result, casualties per gang, Play again and Swap sides. The shot and the end of a battle are reached with dev fixtures
// (?fixture=, client/dev/scenarios.ts) that play the real engine forward. Screenshots land in tools/out/s5c-*.png.
import { expect, test } from '@playwright/test'
import { pending, screenshotRendered, startBattle, TEST_QUERY } from './helpers'

const SHOOT = `${TEST_QUERY}&fixture=shoot`

test('shoot prompt: names the decision and shows hit / wound / save / injury odds that match the engine', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page, SHOOT)
  await page.waitForFunction(() => window.__ms!.settled())
  const p = await pending(page)
  test.skip(!p || p.kind !== 'shoot.target', 'the shoot fixture could not reach a target (engine part missing)')
  await expect(page.getByTestId('prompt')).toHaveAttribute('data-kind', 'shoot.target')
  await expect(page.getByTestId('prompt-title')).toContainText('Choose a target')
  await expect(page.getByTestId('prompt-why')).toContainText('Why it matters')
  const cards = page.getByTestId('target-cards')
  await expect(cards).toBeVisible()
  const first = p!.options!.find((o) => typeof o.action.payload.targetId === 'string')!
  const card = page.getByTestId(`opt-${first.id}`)
  // the odds on the card are the engine's own numbers
  const chance = first.data!.chance as number
  await expect(card.getByTestId('odds-hit')).toContainText(`${Math.round(chance * 100)}%`)
  for (const id of ['odds-wound', 'odds-save', 'odds-si', 'odds-ooa']) await expect(card.getByTestId(id)).toBeVisible()
  await expect(card.getByTestId('odds-summary')).toContainText('Wounds expected')
  // the shooter's card is up beside it with all twelve characteristics and the weapon profiles
  const fc = page.getByTestId('fighter-card')
  await expect(fc.locator('[data-stat]')).toHaveCount(12)
  await expect(fc.getByTestId('weapon-table')).toBeVisible()
  await screenshotRendered(page, 'tools/out/s5c-shoot-prompt.png', 30_000)
  // hovering a term explains it in the shared tooltip; there is no native tooltip anywhere
  await card.getByTestId('odds-hit').locator('[data-keyword]').hover()
  await expect(page.locator('[role="tooltip"]')).toContainText('D6')
  expect(await page.locator('[title]').count()).toBe(0)
  // answering the prompt resolves the shot into the feed
  await card.click()
  await expect(page.getByTestId('event-feed')).toContainText('Hit roll')
  expect(errors).toEqual([])
})

test('fighter card: twelve characteristics, wounds, status, weapons with traits, wargear, skills; changed values stand out', async ({ page }) => {
  await startBattle(page, `${TEST_QUERY}&fixture=card`)
  await page.waitForFunction(() => window.__ms!.settled())
  const fc = page.getByTestId('fighter-card')
  await expect(fc).toBeVisible()
  await expect(fc.locator('[data-stat]')).toHaveCount(12)
  // the fixture gave the leader a Flesh Wound and Concussion: T and I are highlighted
  await expect(fc.locator('[data-stat="T"]')).toHaveAttribute('data-changed', '1')
  await expect(fc.locator('[data-stat="I"]')).toHaveAttribute('data-changed', '1')
  await expect(fc.locator('[data-stat="WS"]')).toHaveAttribute('data-changed', '0')
  await expect(fc.getByTestId('status-chips')).toContainText('Concussion')
  await expect(fc.getByTestId('status-chips')).toContainText('Flesh Wound')
  await expect(fc.getByTestId('card-wounds')).toContainText('/')
  await expect(fc.getByTestId('weapon-table')).toContainText('Chainaxe')
  await expect(fc.getByTestId('card-wargear')).toContainText('Furnace plates')
  await expect(fc.getByTestId('card-skills')).toContainText('Nerves of Steel')
  await expect(fc.getByTestId('card-rules')).toContainText('Group Activation')
  await screenshotRendered(page, 'tools/out/s5c-fighter-card.png', 30_000)
  await fc.locator('[data-keyword="Rending"]').first().hover()
  await expect(page.locator('[role="tooltip"]')).toContainText('natural 6')
  await fc.locator('[data-stat="T"]').hover()
  await expect(page.locator('[role="tooltip"]')).toContainText('Printed')
})

test('HUD: round, phase, standing / down / out, points and the scenario panel', async ({ page }) => {
  await startBattle(page)
  await page.waitForFunction(() => window.__ms!.settled())
  await expect(page.getByTestId('hud-round')).toBeVisible()
  await expect(page.getByTestId('hud-phase')).toContainText(/Set-up|phase|Priority/)
  await expect(page.getByTestId('hud-seat-A')).toContainText('up')
  await expect(page.getByTestId('hud-seat-B')).toContainText('pts')
  // the scenario panel opens from the HUD with the objective and the score
  await page.getByTestId('scenario-toggle').click()
  await expect(page.getByTestId('scenario-panel')).toContainText('How to win')
  await expect(page.getByTestId('scenario-score')).toContainText('points')
  await page.getByTestId('scenario-close').click()
  await expect(page.getByTestId('scenario-panel')).toHaveCount(0)
})

test('end screen: winner, how it was decided, casualties per gang, Play again and Swap sides', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page, `${TEST_QUERY}&fixture=end`)
  const end = page.getByTestId('end-screen')
  await expect(end).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('end-title')).toContainText(/wins|draw/i)
  await expect(page.getByTestId('end-sub')).toContainText('Tunnel Skirmish')
  await expect(page.getByTestId('end-sub')).toContainText('round')
  await expect(page.getByTestId('end-seat-A')).toContainText('Casualties')
  await expect(page.getByTestId('end-seat-B')).toContainText('Points by source')
  await expect(page.getByTestId('end-again')).toHaveText('Play again')
  await screenshotRendered(page, 'tools/out/s5c-end-screen.png', 30_000)
  // view the board, then bring the result back
  await page.getByTestId('end-view').click()
  await expect(end).toHaveCount(0)
  await page.getByTestId('end-show').click()
  await expect(end).toBeVisible()
  // swap sides: the gangs and who plays them trade places and a fresh battle starts
  const before = await page.evaluate(() => (window.__ms!.getState() as { players: { A: { gangName: string } } }).players.A.gangName)
  await page.getByTestId('end-swap').click()
  await expect(end).toHaveCount(0)
  await page.waitForFunction(() => (window.__ms!.getState() as { phase: string } | null)?.phase !== 'ended')
  const after = await page.evaluate(() => ({ seats: (window.__ms!.session() as { seats: Record<string, string> }).seats, a: (window.__ms!.getState() as { players: { A: { gangName: string } } }).players.A.gangName }))
  expect(after.seats).toEqual({ A: 'bot', B: 'human' })
  expect(after.a).not.toBe(before)
  expect(errors).toEqual([])
})

test('charge and fight prompts show reach and the engine\'s fight odds', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // a charge: each target's option carries the chance the D3 gets there
  await startBattle(page, `${TEST_QUERY}&fixture=charge`)
  await page.waitForFunction(() => window.__ms!.settled())
  const c = await pending(page)
  test.skip(!c || c.kind !== 'action.choose', 'the charge fixture could not be reached')
  const charge = page.locator('[data-testid^="opt-charge"]').first()
  await expect(charge).toContainText('to reach')
  await screenshotRendered(page, 'tools/out/s5c-charge-prompt.png', 30_000)
  // a fight: weapon cards with profiles, attack dice and expected results both ways
  await startBattle(page, `${TEST_QUERY}&fixture=fight`)
  await page.waitForFunction(() => window.__ms!.settled())
  const f = await pending(page)
  test.skip(!f || !f.kind.startsWith('fight.'), 'the fight fixture could not be reached')
  await expect(page.getByTestId('prompt')).toHaveAttribute('data-kind', 'fight.weapons')
  await expect(page.getByTestId('fight-cards')).toBeVisible()
  await expect(page.getByTestId('fight-odds').first()).toContainText('expected')
  await screenshotRendered(page, 'tools/out/s5c-fight-prompt.png', 30_000)
  expect(errors).toEqual([])
})
