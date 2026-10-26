// A whole battle through the real client, `speed=instant`: the human seat is answered by `window.__ms.autoStep()`
// (the random bot's choice, dispatched through the store like a click), the other seat by the store's own bot loop.
// Asserts the game ends without stalling (the watchdog), that rejections never pile up as toasts, and that the End
// screen shows VP by source and the kill grades from the engine's mission view.
import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// the bot seat plays with the normal AI tier (the default), in its Web Worker
const QUERY = '?test=1&bot=normal&seats=human,bot&seed=full-1&mission=secure&layout=01&teams=aod,kom&speed=instant'

interface RunResult {
  phase: string
  answered: number
  maxErrorToasts: number
  seq: number
  stalledMs: number
}

// A small viewport and low graphics keep the software renderer from starving the other specs running in parallel.
test.use({ viewport: { width: 800, height: 520 } })

test('plays a whole game to the End screen without stalling', async ({ page }) => {
  test.setTimeout(300_000)
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mancermundo.settings.v1', JSON.stringify({ animSpeed: 'instant', lowGraphics: true }))
    } catch {
      /* storage unavailable */
    }
    // the game logic runs on timers; drawing the board twice a second is plenty for a run nobody watches
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 500)
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(`./${QUERY}`)
  await page.getByTestId('battle').waitFor()
  await page.waitForFunction(() => !!window.__ms?.getState())

  const t0 = Date.now()
  const run = await page.evaluate(
    async (budgetMs): Promise<RunResult> => {
      const ms = window.__ms!
      const t0 = Date.now()
      let answered = 0
      let maxErrorToasts = 0
      let lastSeq = -1
      let lastProgress = Date.now()
      let worstStall = 0
      while (Date.now() - t0 < budgetMs) {
        const s = ms.getState() as { phase: string; seq: number }
        if (s.phase === 'ended') break
        if (s.seq !== lastSeq) {
          lastSeq = s.seq
          lastProgress = Date.now()
        }
        worstStall = Math.max(worstStall, Date.now() - lastProgress)
        const p = ms.getPending() as { seat: string } | null
        if (p && p.seat === 'A' && ms.settled() && ms.autoStep()) answered++
        maxErrorToasts = Math.max(maxErrorToasts, ms.toasts().filter((t) => t.kind === 'error').length)
        await new Promise((r) => setTimeout(r, 0))
      }
      const s = ms.getState() as { phase: string; seq: number }
      return { phase: s.phase, answered, maxErrorToasts, seq: s.seq, stalledMs: worstStall }
    },
    240_000,
  )
  const wallMs = Date.now() - t0
  console.log(`full-game wall time at speed=instant (bot=normal): ${(wallMs / 1000).toFixed(1)} s, ${run.seq} steps, worst stall ${run.stalledMs} ms`)
  writeFileSync('e2e-out/full-game-time.json', JSON.stringify({ bot: 'normal', speed: 'instant', wallMs, seq: run.seq, answered: run.answered, worstStallMs: run.stalledMs }, null, 2))
  if (run.phase !== 'ended' || run.stalledMs >= 12_000) {
    // a stalled game: keep the engine state, the open decision and the last events for the report
    const dump = await page.evaluate(() => ({ state: window.__ms!.getState(), pending: window.__ms!.getPending(), legal: window.__ms!.legal(), events: window.__ms!.events().slice(-60) }))
    writeFileSync('e2e-out/stall.json', JSON.stringify(dump))
  }
  expect(run.phase).toBe('ended')
  expect(run.answered).toBeGreaterThan(40)
  // a stuck decision is answered by the watchdog within seconds; nothing may sit unchanged for long
  expect(run.stalledMs).toBeLessThan(12_000)
  // bot rejections are silent and a human action shows at most one rejection toast
  expect(run.maxErrorToasts).toBeLessThanOrEqual(1)

  await page.waitForFunction(() => window.__ms?.settled() ?? false)
  const end = page.getByTestId('end-screen')
  await expect(end).toBeVisible()
  await expect(page.getByTestId('end-title')).toHaveText(/wins|Draw/)

  const vp = await page.evaluate(() => {
    const s = window.__ms!.getState() as { players: { A: { vp: number }; B: { vp: number } }; mission: { scored: Record<string, { A: number; B: number }> } | null }
    return { A: s.players.A.vp, B: s.players.B.vp, scored: s.mission?.scored ?? {} }
  })
  for (const seat of ['A', 'B'] as const) {
    await expect(page.getByTestId(`end-vp-${seat}`)).toHaveText(`${vp[seat]} VP`)
    // the lines under "By source" are the engine's own mission ledger and add up to the seat's VP
    const lines = await page.locator(`[data-testid^="end-source-${seat}-"] b`).allTextContents()
    const total = lines.reduce((n, t) => n + Number(t), 0)
    expect(total).toBe(vp[seat])
    // kill grade comes from the mission view
    await expect(page.getByTestId(`end-kill-${seat}`)).toContainText(/Grade \d\/5 with \d+ enemy operatives down/)
  }
  expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([])
})
