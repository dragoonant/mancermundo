// The seven M10 batch D teams (Blooded, Fellgor Ravagers, Chaos Cult, Goremongers, Scout Squad, Tempestus Aquilons, Exaction
// Squad) through the client: each one (played by the normal AI in the bot seat) meets an existing team (played by the random
// bot through the human seat's auto-step), the game runs to turning point 3 without page errors or error toasts, and the
// battle is screenshotted to tools/out/screens/<team>.png. A Chaos Cult game runs until a Devotee mutates and checks the
// figure swaps with the event, the short cue plays and the card shows the new form; that moment is screenshotted too.
import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { screenshotRendered } from './helpers'

const OLD_TEAMS = ['aod', 'kom']
const BATCH_D = ['blooded', 'fellgor-ravagers', 'chaos-cult', 'goremongers', 'scout-squad', 'tempestus-aquilons', 'exaction-squad'] as const

test.use({ viewport: { width: 1280, height: 720 } })

async function prepare(page: Page, anim: 'instant' | 'fast' = 'instant'): Promise<string[]> {
  await page.addInitScript((speed) => {
    try {
      localStorage.setItem('mancermundo.settings.v1', JSON.stringify({ animSpeed: speed, lowGraphics: true }))
    } catch {
      /* storage unavailable */
    }
  }, anim)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|WebGL|GPU/i.test(m.text())) errors.push(m.text())
  })
  return errors
}

interface Progress {
  tp: number
  phase: string
  errorToasts: number
  stop: string | null
}

/** Answer the human seat with the random bot until the battle reaches `untilTp` (or ends, or a Devotee mutates when `untilMutation`). */
async function playTo(page: Page, untilTp: number, untilMutation = false, budgetMs = 150_000): Promise<Progress> {
  const t0 = Date.now()
  let errorToasts = 0
  let last = { tp: 0, phase: '' }
  let stop: string | null = null
  while (Date.now() - t0 < budgetMs) {
    const snap = await page.evaluate(() => {
      const ms = window.__ms!
      const s = ms.getState() as { phase: string; turningPoint: number }
      const transformed = (ms.events() as { type: string }[]).some((e) => e.type === 'OperativeTransformed')
      return { phase: s.phase, tp: s.turningPoint, errors: ms.toasts().filter((t) => t.kind === 'error').length, mine: (ms.getPending() as { seat: string } | null)?.seat === 'A', settled: ms.settled(), transformed }
    })
    last = { tp: snap.tp, phase: snap.phase }
    errorToasts = Math.max(errorToasts, snap.errors)
    if (untilMutation && snap.transformed) {
      stop = 'transformed'
      break
    }
    if (snap.phase === 'ended' || (!untilMutation && snap.phase === 'firefight' && snap.tp >= untilTp && snap.settled && snap.mine)) break
    if (snap.mine && snap.settled) await page.evaluate(() => window.__ms!.autoStep())
    else await page.waitForTimeout(15)
  }
  return { ...last, errorToasts, stop }
}

for (const team of BATCH_D) {
  test(`${team} plays a battle against an existing team and is screenshotted`, async ({ page }) => {
    test.setTimeout(240_000)
    const errors = await prepare(page)
    const foe = OLD_TEAMS[BATCH_D.indexOf(team) % OLD_TEAMS.length]!
    await page.goto(`./?test=1&bot=normal&seats=human,bot&seed=bd-${team}&mission=secure&layout=01&teams=${foe},${team}&speed=instant`)
    await page.getByTestId('battle').waitFor()
    await page.waitForFunction(() => !!window.__ms?.getState())
    const p = await playTo(page, 3)
    expect(errors).toEqual([])
    expect(p.errorToasts).toBe(0)
    expect(p.phase === 'ended' || p.tp >= 3).toBe(true)
    // a token chip on the operative card: select an operative that carries one
    const carrier = await page.evaluate(() => {
      const s = window.__ms!.getState() as { operatives: Record<string, { id: string; status: string; tokens?: { count: number }[] }> }
      return Object.values(s.operatives).find((o) => o.status === 'active' && (o.tokens ?? []).some((t) => t.count > 0))?.id ?? null
    })
    if (carrier) {
      await page.evaluate((id) => (window.__ms!.ui() as { set(p: object): void }).set({ selectedOp: id }), carrier)
      await expect(page.getByTestId('card-tokens').first()).toBeVisible()
    }
    mkdirSync('tools/out/screens', { recursive: true })
    await screenshotRendered(page, `tools/out/screens/${team}.png`)
  })
}

test('chaos cult: a Devotee mutates, the figure swaps with the event, a cue plays and the card names the new form', async ({ page }) => {
  test.setTimeout(300_000)
  const errors = await prepare(page, 'fast')
  await page.goto('./?test=1&bot=normal&seats=human,bot&seed=bd-mutation&mission=secure&layout=01&teams=aod,chaos-cult&speed=fast')
  await page.getByTestId('battle').waitFor()
  await page.waitForFunction(() => !!window.__ms?.getState())
  const p = await playTo(page, 4, true, 240_000)
  expect(p.stop, 'a Devotee mutated within the budget').toBe('transformed')
  const ev = await page.evaluate(() => (window.__ms!.events() as { type: string; operativeId: string; from: string; to: string }[]).find((e) => e.type === 'OperativeTransformed')!)
  // the presentation catches up: the display state (what the figure is drawn from) shows the new datacard
  await page.waitForFunction(() => window.__ms!.settled(), undefined, { timeout: 30_000 })
  const shown = await page.evaluate((id) => (window.__ms!.display() as { operatives: Record<string, { datacardId: string }> }).operatives[id]!.datacardId, ev.operativeId)
  expect(shown).toBe(ev.to)
  expect(ev.to).not.toBe(ev.from)
  // the short cue: its sound was requested and the feed has the line
  const sounds = await page.evaluate(() => window.__ms!.sounds())
  expect(sounds).toContain('fx-reanimate')
  await expect(page.getByTestId('event-feed')).toContainText('becomes')
  // the card shows the form chip
  await page.evaluate((id) => (window.__ms!.ui() as { set(p: object): void }).set({ selectedOp: id }), ev.operativeId)
  await expect(page.getByTestId('card-chip').first()).toBeVisible()
  expect(errors).toEqual([])
  mkdirSync('tools/out/screens', { recursive: true })
  await screenshotRendered(page, 'tools/out/screens/chaos-cult-mutation.png')
})
