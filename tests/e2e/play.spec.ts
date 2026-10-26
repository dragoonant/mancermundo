// S5a: a human plays seat A against the random bot in the browser. Deploy by clicks, activate a fighter by clicking it, open a door
// by clicking the door, move by clicking the board, then end activations until the round is over and the next one begins.
// The shoot step is taken when the engine offers Shoot (S3a): the prompts are walked and the shot must reach the feed; when Shoot is
// never offered to the human in the round the step is skipped with a todo annotation.
import { expect, test, type Page } from '@playwright/test'

const URL = './?test=1&seed=s5a&speed=instant&seats=human,bot&scenario=tunnel-skirmish&board=foundry-run'

const kind = (page: Page) => page.evaluate(() => (window as any).__ms.getPending()?.kind ?? null)
const phase = (page: Page) => page.evaluate(() => (window as any).__ms.getState().phase as string)

/** Wait until the human has a prompt (or the battle ended); returns its decision kind. */
async function humanKind(page: Page): Promise<string | null> {
  await page.waitForFunction(() => !!document.querySelector('[data-testid="prompt"]') || (window as any).__ms?.getState()?.phase === 'ended', undefined, { timeout: 30_000 })
  return page.getByTestId('prompt').count().then(async (n) => (n ? page.getByTestId('prompt').getAttribute('data-kind') : null))
}

async function focusOn(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(([px, pz]) => (window as any).__ms.camera.current?.lookAt(px!, pz!, 15), [x, z])
  await page.waitForTimeout(150)
}

async function pixel(page: Page, x: number, y: number, z: number): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(([a, b, c]) => (window as any).__ms.project(a!, b!, c!), [x, y, z])
  expect(p).not.toBeNull()
  return p!
}

/** Deploy spot beside an unlocked door inside the deploying seat's strips, found from the engine's own verdict. */
async function doorSpot(page: Page): Promise<{ x: number; z: number; doorId: string; door: { x: number; z: number } } | null> {
  return page.evaluate(() => {
    const ms = (window as any).__ms
    const s = ms.getState()
    for (const d of s.board.def.doors) {
      if (d.lockedAtStart) continue
      const a = d.seg.a
      const b = d.seg.b
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      const nx = -(b.z - a.z) / len
      const nz = (b.x - a.x) / len
      const c = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
      const ux = (b.x - a.x) / len
      const uz = (b.z - a.z) / len
      for (const side of [1, -1]) {
        for (const off of [0.9, 1.0, 1.1]) {
          for (const along of [0, -0.5, 0.5, -0.9, 0.9]) {
            const x = Math.round((c.x + nx * off * side + ux * along) * 100) / 100
            const z = Math.round((c.z + nz * off * side + uz * along) * 100) / 100
            if (ms.deployOk(x, z)) return { x, z, doorId: d.id, door: c }
          }
        }
      }
    }
    return null
  })
}

test('play: deploy, open a door, move, end the round against the random bot', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(URL)
  await expect(page.locator('canvas')).toBeVisible()

  // ---- set-up: answer the roll-off choices, then deploy by clicks (the first fighter beside a door, the rest by the engine's spots)
  let doorId: string | null = null
  let doorAt: { x: number; z: number } | null = null
  let deployedByClick = false
  for (let guard = 0; guard < 60; guard++) {
    const k = await humanKind(page)
    if (k === 'action.activate') break
    if (k === 'setup.deploy') {
      if (!deployedByClick) {
        const spot = await doorSpot(page)
        if (spot) {
          doorId = spot.doorId
          doorAt = spot.door
          await focusOn(page, spot.x, spot.z)
          const p = await pixel(page, spot.x, 0, spot.z)
          await page.mouse.move(p.x, p.y)
          await expect(page.getByTestId('board-tag').first()).toContainText('Deploy here')
          await page.mouse.click(p.x, p.y)
          deployedByClick = true
          await page.waitForFunction(() => Object.values<any>((window as any).__ms.getState().fighters).some((f) => f.seat === 'A' && f.location === 'board'))
          continue
        }
      }
      await page.getByTestId('deploy-auto').click()
      continue
    }
    // role / zone / crew / anything else: take the first option
    await page.locator('[data-testid^="opt-"]').first().click()
  }
  expect(await phase(page)).toBe('action')
  await page.screenshot({ path: 'tools/out/s5a-play-1-deployed.png' })

  // ---- the Action phase: activate the fighter that stands beside the door by clicking it on the board
  expect(doorId).not.toBeNull()
  const doorFighter = await page.evaluate(([dx, dz]) => {
    const s = (window as any).__ms.getState()
    const mine = Object.values<any>(s.fighters).filter((f) => f.seat === 'A' && f.location === 'board')
    mine.sort((p, q) => Math.hypot(p.pos.x - dx!, p.pos.z - dz!) - Math.hypot(q.pos.x - dx!, q.pos.z - dz!))
    return { id: mine[0].id as string, x: mine[0].pos.x as number, z: mine[0].pos.z as number }
  }, [doorAt!.x, doorAt!.z])
  await focusOn(page, doorFighter.x, doorFighter.z)
  const fp = await pixel(page, doorFighter.x, 1, doorFighter.z)
  await page.mouse.click(fp.x, fp.y)
  // a leader or champion may bring a group along: decline it
  await page.waitForFunction(() => ['action.choose', 'action.group'].includes((window as any).__ms.getPending()?.kind))
  if ((await kind(page)) === 'action.group') await page.getByTestId('opt-done').click()
  await expect(page.getByTestId('prompt')).toHaveAttribute('data-kind', 'action.choose')
  await expect(page.getByTestId('activation-info')).toContainText('2 actions left')

  // open the door by clicking it on the board
  // the upper panel: the fighter standing in front hides the lower part from this camera
  const dp = await pixel(page, doorAt!.x, 2.7, doorAt!.z)
  await page.mouse.click(dp.x, dp.y)
  await page.waitForFunction((id) => (window as any).__ms.getState().board.doors[id!].state === 'open', doorId)
  await expect(page.getByTestId('event-feed')).toContainText('is open')

  // move by clicking the board: the engine's route, the inches left shown while hovering
  await expect(page.getByTestId('prompt')).toHaveAttribute('data-kind', 'action.choose')
  await page.getByTestId('opt-move').click()
  await expect(page.getByTestId('prompt')).toHaveAttribute('data-kind', 'move.path')
  const target = await page.evaluate(([fx, fz, dx, dz]) => {
    // two inches straight through the doorway
    const len = Math.hypot(dx! - fx!, dz! - fz!) || 1
    return { x: Math.round((fx! + ((dx! - fx!) / len) * 2.5) * 100) / 100, z: Math.round((fz! + ((dz! - fz!) / len) * 2.5) * 100) / 100 }
  }, [doorFighter.x, doorFighter.z, doorAt!.x, doorAt!.z])
  const verdict = await page.evaluate(([x, z]) => (window as any).__ms.routeOk(x!, z!), [target.x, target.z])
  expect(verdict.ok, verdict.reason ?? '').toBe(true)
  const tp = await pixel(page, target.x, 0, target.z)
  await page.mouse.move(tp.x, tp.y)
  await expect(page.getByTestId('move-note')).toContainText('Move here')
  await expect(page.getByTestId('board-tag').first()).toContainText('left')
  await page.screenshot({ path: 'tools/out/s5a-play-2-move-preview.png' })
  await page.mouse.click(tp.x, tp.y)
  await page.waitForFunction(
    ({ id, x, z }) => {
      const f = (window as any).__ms.getState().fighters[id]
      return Math.hypot(f.pos.x - x, f.pos.z - z) < 0.05
    },
    { id: doorFighter.id, x: target.x, z: target.z },
  )
  await expect(page.getByTestId('event-feed')).toContainText('moves')

  // ---- end the round: answer every human prompt (end activations, first option otherwise) until round 2 begins
  // The first time Shoot is offered it is taken (at whatever the engine lists first: a door, or an enemy in sight), which walks the
  // shoot.weapon / shoot.target prompts and puts the shot in the feed.
  let shot = false
  for (let guard = 0; guard < 400; guard++) {
    const s = await page.evaluate(() => ({ round: (window as any).__ms.getState().round as number, phase: (window as any).__ms.getState().phase as string }))
    if (s.round >= 2 || s.phase === 'ended') break
    const k = await humanKind(page)
    if (k === 'action.choose') {
      if (!shot && (await page.getByTestId('opt-shoot').count())) {
        shot = true
        await page.getByTestId('opt-shoot').click()
      } else await page.getByTestId('opt-end').click()
    }
    else if (k === 'move.path') await page.getByTestId('move-cancel').click()
    else if (k === 'setup.deploy') await page.getByTestId('deploy-auto').click()
    else if (k) await page.locator('[data-testid^="opt-"]').first().click()
  }
  if (shot) await expect(page.getByTestId('event-feed')).toContainText('shoots with')
  else test.info().annotations.push({ type: 'todo', description: 'Shoot was never offered to the human this round; assert the shot in the feed when it is' })
  const end = await page.evaluate(() => ({ round: (window as any).__ms.getState().round as number, phase: (window as any).__ms.getState().phase as string }))
  expect(end.round >= 2 || end.phase === 'ended').toBe(true)
  await expect(page.getByTestId('hud-round')).toContainText(/Round 2|Round \d/)
  await page.screenshot({ path: 'tools/out/s5a-play-3-round-2.png' })
  expect(errors).toEqual([])
})
