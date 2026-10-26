// Shared e2e helpers: start a battle through the test URL parameters, wait for the presentation to settle,
// and take a screenshot only once the demand-driven canvas has actually been drawn.
import type { Page } from '@playwright/test'

export const TEST_QUERY = '?test=1&seats=human,bot&seed=e2e-1&mission=secure&layout=01&teams=aod,kom&speed=instant'

export async function startBattle(page: Page, query = TEST_QUERY): Promise<void> {
  await page.goto(`./${query}`)
  await page.getByTestId('battle').waitFor()
  await page.waitForFunction(() => !!window.__ms?.getState())
}

export interface Pending {
  id: string
  seat: 'A' | 'B'
  kind: string
  canPass: boolean
  options?: { id: string; action: { type: string; payload: Record<string, unknown> } }[]
  constraints?: { operativeId?: string; operativeIds?: string[]; maxInches?: number; kind?: string }
  context: Record<string, unknown>
}

export async function pending(page: Page): Promise<Pending | null> {
  return page.evaluate(() => (window.__ms?.getPending() as Pending | null) ?? null)
}

/** True when the presentation has caught up and a prompt for the human seat is on screen. */
export async function humanTurn(page: Page): Promise<Pending | null> {
  const p = await pending(page)
  if (!p || p.seat !== 'A') return null
  const settled = await page.evaluate(() => window.__ms?.settled() ?? false)
  return settled ? p : null
}

/** Wait until the human seat has a settled decision (or the battle is over); returns it. */
export async function nextHumanDecision(page: Page, afterId: string | null, timeoutMs = 20_000): Promise<Pending | null> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const over = await page.evaluate(() => (window.__ms?.getState() as { phase?: string } | null)?.phase === 'ended')
    if (over) return null
    const p = await humanTurn(page)
    if (p && p.id !== afterId) {
      await page.getByTestId('decision-prompt').waitFor({ timeout: 5000 })
      return p
    }
    await page.waitForTimeout(40)
  }
  throw new Error(`no human decision after ${afterId} within ${timeoutMs}ms`)
}

/** A canvas pixel for a world point that is not covered by any DOM panel (so a click reaches the board). */
export async function boardPixel(page: Page, x: number, y: number, z: number): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ([wx, wy, wz]) => {
      const p = window.__ms?.project(wx!, wy!, wz!)
      if (!p) return null
      const el = document.elementFromPoint(p.x, p.y)
      return el && el.tagName === 'CANVAS' ? p : null
    },
    [x, y, z] as const,
  )
}

/** Screenshot that waits for the board to be drawn: the canvas uses a demand-driven frame loop, so a shot taken
 *  right after a layout change can catch a cleared canvas. Nudges a repaint, lets two animation frames pass and
 *  retries when the PNG is implausibly small for a 3D scene. */
export async function screenshotRendered(page: Page, path: string, minBytes = 60_000): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      window.__ms?.camera.current?.repaint()
      return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    })
    await page.waitForTimeout(250 + i * 250)
    const buf = await page.screenshot({ path })
    if (buf.length >= minBytes) return
  }
}

// ---------------------------------------------------------------- driving a game through the UI

export interface E2eOp {
  id: string
  seat: 'A' | 'B'
  status: string
  pos: { x: number; y: number; z: number }
  baseRadius: number
  wounds: number
}

export interface E2eState {
  ops: E2eOp[]
  phase: string
  tp: number
  seq: number
  log: { type: string; seat: string }[]
  vp: { A: number; B: number }
}

export const snapshot = (page: Page): Promise<E2eState> =>
  page.evaluate(() => {
    const s = window.__ms!.getState() as {
      operatives: Record<string, E2eOp>
      log: { type: string; seat: string }[]
      phase: string
      turningPoint: number
      seq: number
      players: { A: { vp: number }; B: { vp: number } }
    }
    return { ops: Object.values(s.operatives), phase: s.phase, tp: s.turningPoint, seq: s.seq, log: s.log.map((a) => ({ type: a.type, seat: a.seat })), vp: { A: s.players.A.vp, B: s.players.B.vp } }
  })

/** Event types of the battle so far (the store keeps them for the end screen). */
export const eventTypes = (page: Page, seat?: 'A' | 'B'): Promise<string[]> =>
  page.evaluate((s) => (window.__ms!.events() as { type: string; seat: string | null }[]).filter((e) => !s || e.seat === s).map((e) => e.type), seat)

/** Deploy one operative: ask the engine for legal spots whose pixel is not under a panel, click until one is accepted
 *  (a tall wall in front of a spot catches the click and the engine rejects it, which is a legitimate miss). */
export async function deployOne(page: Page): Promise<void> {
  const seq0 = await page.evaluate(() => (window.__ms!.getState() as { seq: number }).seq)
  for (let skip = 0; skip < 600; skip += 9) {
    const spot = await page.evaluate((k) => window.__ms!.suggestSpot(k), skip)
    if (!spot) throw new Error('no legal deploy spot')
    const px = await boardPixel(page, spot.x, spot.y, spot.z)
    if (!px) continue
    await page.mouse.move(px.x, px.y)
    await page.mouse.click(px.x, px.y)
    await page.waitForTimeout(60)
    const seq = await page.evaluate(() => (window.__ms!.getState() as { seq: number }).seq)
    if (seq > seq0) return
  }
  // every legal spot sits under a panel (a drop zone along the bottom edge, behind the prompt): use the prompt's own auto-place button
  await page.getByTestId('deploy-auto').click()
  await page.waitForFunction((s) => (window.__ms!.getState() as { seq: number }).seq > s, seq0)
}

/** The enemy closest to an operative (by centre distance), or null. */
export function nearestEnemy(ops: E2eOp[], me: E2eOp): { op: E2eOp; dist: number } | null {
  let best: { op: E2eOp; dist: number } | null = null
  for (const o of ops) {
    if (o.seat === me.seat || o.status !== 'active') continue
    const d = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z)
    if (!best || d < best.dist) best = { op: o, dist: d }
  }
  return best
}

/** Try each world point as the end of a one-step path; confirm the first the engine accepts. False when none worked (the action is cancelled). */
export async function tryMovePoints(page: Page, y: number, points: { x: number; z: number }[]): Promise<boolean> {
  for (const p of points) {
    const px = await boardPixel(page, p.x, y, p.z)
    if (!px) continue
    await page.mouse.move(px.x, px.y)
    await page.mouse.click(px.x, px.y)
    await page.waitForTimeout(30)
    const confirm = page.getByTestId('move-confirm')
    // the prompt can change under us (the decision was answered): stop instead of waiting for buttons that are gone
    if ((await confirm.count()) === 0) return false
    if (await confirm.isEnabled()) {
      await confirm.click()
      return true
    }
    // the click may not have landed a waypoint at all (then Clear is disabled)
    const clear = page.getByTestId('move-clear')
    if ((await clear.count()) > 0 && (await clear.isEnabled())) await clear.click()
  }
  if ((await page.getByTestId('move-cancel').count()) > 0) await page.getByTestId('move-cancel').click()
  return false
}

/** Candidate end points for moving `me` toward `foe`: `stop` inches short of its centre, fanned by a few angles, then shorter hops. */
export function approachPoints(me: E2eOp, foe: E2eOp, stop: number, maxHop: number): { x: number; z: number }[] {
  const dx = foe.pos.x - me.pos.x
  const dz = foe.pos.z - me.pos.z
  const dist = Math.hypot(dx, dz) || 1
  const out: { x: number; z: number }[] = []
  const base = Math.atan2(dx, dz)
  for (const hop of [Math.max(0.5, dist - stop), Math.min(maxHop, dist - stop), Math.min(4, dist - stop), 2]) {
    for (const fan of [0, 0.35, -0.35, 0.7, -0.7]) {
      const a = base + fan
      const h = Math.max(0.4, hop)
      out.push({ x: me.pos.x + Math.sin(a) * h, z: me.pos.z + Math.cos(a) * h })
    }
  }
  return out
}

/** Points on a ring around `foe` (just outside both bases, `gap` inches apart), nearest to `me` first: where a charge can end. */
export function aroundPoints(me: E2eOp, foe: E2eOp, gap: number): { x: number; z: number }[] {
  const r = foe.baseRadius + me.baseRadius + gap
  const out: { x: number; z: number; d: number }[] = []
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI * 2) / 16
    const x = foe.pos.x + Math.sin(a) * r
    const z = foe.pos.z + Math.cos(a) * r
    out.push({ x, z, d: Math.hypot(x - me.pos.x, z - me.pos.z) })
  }
  return out.sort((p, q) => p.d - q.d)
}
