// Plays a real game slice through the UI against the random bot: deploy every operative by clicking the
// board, get through the strategy phase, then at least two activations that each move (play-01..04.png). A second
// test plays on until the human has resolved a Shoot and a Fight through the dedicated prompts (play-05..08.png).
import { expect, test, type Page } from '@playwright/test'
import { approachPoints, aroundPoints, boardPixel, deployOne, detourRoutes, dispatchMove, eventTypes, nearestEnemy, nextHumanDecision, screenshotRendered, snapshot, startBattle, tryMovePoints, type E2eOp, type Pending } from './helpers'

interface Op {
  id: string
  seat: 'A' | 'B'
  status: string
  pos: { x: number; y: number; z: number }
  baseRadius: number
}

const state = (page: Page) =>
  page.evaluate(() => {
    const s = window.__ms!.getState() as { operatives: Record<string, Op>; log: { type: string; seat: string }[]; phase: string; turningPoint: number }
    return { ops: Object.values(s.operatives), moves: s.log.filter((a) => a.type === 'move.path' && a.seat === 'A').length, phase: s.phase, tp: s.turningPoint }
  })

/** Click a step toward the board centre; confirm if the engine accepts it, else try another direction or length. */
async function moveOne(page: Page, p: Pending): Promise<boolean> {
  const opId = p.constraints!.operativeId!
  const { ops } = await state(page)
  const op = ops.find((o) => o.id === opId)!
  const dirs = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4)
  const toCentre = Math.atan2(-op.pos.x, -op.pos.z)
  const points: { x: number; z: number }[] = []
  // longer steps first reach past friendly bases packed in a drop zone corner
  for (const len of [4, 2.5, 1.5]) for (const d of [toCentre, ...dirs]) points.push({ x: op.pos.x + Math.sin(d) * len, z: op.pos.z + Math.cos(d) * len })
  // a click can land on a figure or a prompt edge, so unregistered clicks are skipped; with no legal step the action is cancelled (no AP spent)
  return tryMovePoints(page, op.pos.y, points)
}

test('deploy, strategy phase and two moving activations on the real engine', async ({ page }) => {
  test.setTimeout(150_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page)
  await expect(page.getByTestId('hud')).toBeVisible()
  await expect(page.getByTestId('hud-phase')).toContainText(/Roll off/i)
  await screenshotRendered(page, 'e2e-out/play-01.png')

  let last: string | null = null
  let sawStrategy = false
  let sawFirefight = false
  let shot2 = false
  let shot3 = false
  let activationsWithMove = 0
  let movesBefore = 0
  let failedMoves = 0
  for (let step = 0; step < 400; step++) {
    const p = await nextHumanDecision(page, last)
    if (!p) break
    last = p.id
    const s = await state(page)
    if (s.phase === 'strategy') sawStrategy = true
    if (s.phase === 'firefight') sawFirefight = true
    if (!shot2 && p.kind === 'firefight.activate') {
      shot2 = true
      await screenshotRendered(page, 'e2e-out/play-02.png')
    }
    switch (p.kind) {
      case 'setup.deploy':
        await deployOne(page)
        break
      case 'firefight.activate':
        failedMoves = 0
        await page.getByTestId(`activate-${(p.context.ready as string[])[0]}`).click()
        break
      case 'firefight.order':
        await page.getByTestId('order-engage').click()
        break
      case 'firefight.action': {
        // an operative with no legal step (boxed in) ends its activation instead of retrying the move for ever
        const want = s.moves - movesBefore < 1 && failedMoves < 2 ? ['reposition', 'dash'] : []
        let clicked = false
        for (const a of want) {
          const btn = page.getByTestId(`act-${a}`)
          if ((await btn.count()) > 0 && (await btn.isEnabled())) {
            await btn.click()
            clicked = true
            break
          }
        }
        if (!clicked) {
          if (s.moves - movesBefore >= 1) {
            activationsWithMove++
            movesBefore = s.moves
          }
          await page.getByTestId('act-end').click()
        }
        break
      }
      case 'move.path':
        if (activationsWithMove === 1 && !shot3) {
          shot3 = true
          const op = (await state(page)).ops.find((o) => o.id === p.constraints!.operativeId)!
          const px = await boardPixel(page, op.pos.x + 2, op.pos.y, op.pos.z + 2)
          if (px) await page.mouse.move(px.x, px.y)
          await screenshotRendered(page, 'e2e-out/play-03.png')
        }
        if (!(await moveOne(page, p))) failedMoves++
        break
      case 'strategy.gambit':
        await page.getByTestId('opt-pass').click()
        break
      default: {
        // rolls, initiative choices, drop zones, ties: take the first offered option
        await page.locator('[data-testid^="opt-"]').first().click()
      }
    }
    if (activationsWithMove >= 2) break
  }
  const end = await state(page)
  expect(sawStrategy).toBe(true)
  expect(sawFirefight).toBe(true)
  expect(end.ops.filter((o) => o.status === 'active').length).toBe(end.ops.length)
  expect(end.moves).toBeGreaterThanOrEqual(2)
  expect(activationsWithMove).toBeGreaterThanOrEqual(2)
  await screenshotRendered(page, 'e2e-out/play-04.png')
  expect(errors).toEqual([])
})

// ---------------------------------------------------------------- Shoot and Fight through the dedicated prompts

const SHOT = (n: number) => `e2e-out/play-0${n}.png`

/** Move toward the enemy (or around it for a charge); the engine decides which end points are legal. */
async function moveToward(page: Page, p: Pending, intent: 'charge' | 'approach'): Promise<boolean> {
  const { ops } = await snapshot(page)
  const me = ops.find((o) => o.id === p.constraints!.operativeId) as E2eOp
  const near = nearestEnemy(ops, me)
  if (!near) {
    await page.getByTestId('move-cancel').click()
    return false
  }
  const max = p.constraints?.maxInches ?? 6
  const points = intent === 'charge' ? aroundPoints(me, near.op, 0.3) : approachPoints(me, near.op, 2.5, max - 0.4)
  // the official cards are dense: a straight line to the enemy is often blocked, so detours are tried too; the moves
  // are dispatched because a ground point beside a building can sit behind its wall on screen (the first test clicks)
  return dispatchMove(page, detourRoutes(me, points))
}

test('a Shoot and a Fight resolved through the prompts, with the dice tray showing both pools', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startBattle(page)

  const seen = new Set<string>()
  const shots: Record<number, boolean> = {}
  let last: string | null = null
  let shotDone = false
  let fightDone = false
  let traySeen = false
  let pairsSeen = false
  let chargeTries = 0
  let failedMoves = 0
  let failedCharges = 0
  for (let step = 0; step < 1500 && !(shotDone && fightDone); step++) {
    const p = await nextHumanDecision(page, last, 30_000)
    if (!p) break
    last = p.id
    seen.add(p.kind)
    const types = await eventTypes(page, 'A')
    shotDone ||= types.includes('ShootEnded')
    fightDone ||= types.includes('FightEnded')
    if (p.kind !== 'setup.deploy' && !traySeen && (await page.getByTestId('dice-tray').count()) > 0) {
      traySeen = true
      await expect(page.getByTestId('tray-atk')).toBeVisible()
    }
    if ((await page.locator('[data-testid="tray-die"][data-spent="blocking"]').count()) > 0) pairsSeen = true
    switch (p.kind) {
      case 'setup.deploy':
        await deployOne(page)
        break
      case 'strategy.gambit':
      case 'ploy.firefight':
      case 'guard.interrupt':
      case 'marker.place':
        await page.getByTestId('opt-pass').click()
        break
      case 'firefight.activate': {
        const { ops } = await snapshot(page)
        failedMoves = 0
        failedCharges = 0
        const ready = (p.context.ready as string[]).map((id) => ops.find((o) => o.id === id)!).filter(Boolean)
        ready.sort((a, b) => (nearestEnemy(ops, a)?.dist ?? 99) - (nearestEnemy(ops, b)?.dist ?? 99))
        // nothing ready: the only answer is to skip the counteraction
        if (ready.length === 0) await page.getByTestId('opt-pass').click()
        else await page.getByTestId(`activate-${ready[0]!.id}`).click()
        break
      }
      case 'firefight.order':
        await page.getByTestId('order-engage').click()
        break
      case 'firefight.action': {
        const enabled = async (id: string) => (await page.getByTestId(`act-${id}`).count()) > 0 && (await page.getByTestId(`act-${id}`).isEnabled())
        const { ops } = await snapshot(page)
        const me = ops.find((o) => o.id === String(p.context.operativeId))
        const gap = me ? (nearestEnemy(ops, me)?.dist ?? 99) : 99
        if (!fightDone && (await enabled('fight'))) await page.getByTestId('act-fight').click()
        else if (!shotDone && (await enabled('shoot'))) await page.getByTestId('act-shoot').click()
        // a Charge whenever an enemy may be in reach (the engine says whether a route exists; a failed one costs no AP),
        // else close in so a later activation can charge
        else if (!fightDone && failedCharges === 0 && gap <= 10 && (await enabled('charge'))) {
          chargeTries++
          await page.getByTestId('act-charge').click()
        } else if (!fightDone && failedMoves < 2 && (await enabled('reposition'))) await page.getByTestId('act-reposition').click()
        else if (!fightDone && failedMoves < 2 && (await enabled('dash'))) await page.getByTestId('act-dash').click()
        else await page.getByTestId('act-end').click()
        break
      }
      case 'move.path':
        if (p.constraints?.kind === 'charge') {
          if (!(await moveToward(page, p, 'charge'))) failedCharges++
        } else if (!(await moveToward(page, p, 'approach'))) failedMoves++
        break
      case 'shoot.weapon': {
        await expect(page.getByTestId('weapon-cards')).toBeVisible()
        await expect(page.getByTestId('weapon-stats').first()).toContainText(/Atk \d+ · Hit \d\+ · Dmg \d+\/\d+/)
        await expect(page.getByTestId('weapon-odds').first()).toContainText(/expected damage/i)
        if (!shots[5]) {
          shots[5] = true
          await screenshotRendered(page, SHOT(5))
        }
        await page.locator('[data-testid^="opt-"]').first().click()
        break
      }
      case 'shoot.target': {
        if (p.context.secondary !== true) {
          await expect(page.getByTestId('target-cards')).toBeVisible()
          await expect(page.getByTestId('verdict-pill').first()).toBeVisible()
          await expect(page.getByTestId('target-line').first()).toContainText(/expected damage .* kill \d+%/)
          // the board carries the same verdicts above the figures
          expect(await page.locator('[data-testid^="board-badge-"]').count()).toBeGreaterThan(0)
          if (!shots[6]) {
            shots[6] = true
            await screenshotRendered(page, SHOT(6))
          }
        }
        await page.locator('[data-testid^="opt-"]').first().click()
        break
      }
      case 'shoot.coverSave':
        await expect(page.getByTestId('cover-explain')).toContainText(/guaranteed/)
        await page.getByTestId('opt-retain').click()
        break
      case 'shoot.block':
        await expect(page.getByTestId('opt-auto')).toBeVisible()
        await expect(page.getByTestId('block-damage').first()).toBeVisible()
        await page.getByTestId('opt-auto').click()
        break
      case 'dice.reroll':
      case 'dice.commandReroll':
        await expect(page.getByTestId('prompt-dice-row')).toBeVisible()
        await page.getByTestId('opt-pass').click()
        break
      case 'fight.resolve': {
        await expect(page.getByTestId('fight-hint')).toBeVisible()
        expect(await page.getByTestId('prompt-dice-row').count()).toBe(2)
        await expect(page.getByTestId('dice-tray')).toBeVisible()
        if (!shots[7]) {
          shots[7] = true
          await screenshotRendered(page, SHOT(7))
        }
        const best = page.locator('[data-testid^="opt-"][data-best="1"]')
        if ((await best.count()) > 0) await best.first().click()
        else await page.locator('[data-testid^="opt-"]').first().click()
        break
      }
      default:
        await page.locator('[data-testid^="opt-"]').first().click()
    }
  }
  const types = await eventTypes(page, 'A')
  expect(types).toContain('ShootEnded')
  expect(types).toContain('FightEnded')
  expect(seen.has('shoot.weapon') || seen.has('shoot.target')).toBe(true)
  expect(traySeen).toBe(true)
  // the tray keeps the last attack on screen once the presentation settles
  await page.waitForFunction(() => window.__ms?.settled() ?? false)
  await expect(page.getByTestId('dice-tray')).toBeVisible()
  await expect(page.getByTestId('tray-def')).toBeVisible()
  await screenshotRendered(page, SHOT(8))
  expect(pairsSeen || types.includes('DiceBlocked')).toBe(true)
  expect(errors).toEqual([])
})
