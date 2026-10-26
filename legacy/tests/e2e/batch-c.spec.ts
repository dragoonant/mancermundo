// The seven M10 batch C teams (Kasrkin, Novitiates, Phobos Strike Team, Corsair Voidscarred, Warpcoven, Farstalker Kinband,
// Imperial Navy Breachers) through the client: each one (played by the normal AI in the bot seat) meets an existing team
// (played by the random bot through the human seat's auto-step), the game runs to turning point 3 without page errors or
// error toasts, and the battle is screenshotted to tools/out/screens/<team>.png. The Novitiates show their Faith pool in the
// HUD with a tooltip. The team builder fields a legal roster for every batch C team, randomises loadouts to a legal build and
// mounts the 3D preview.
import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { screenshotRendered } from './helpers'

const OLD_TEAMS = ['aod', 'kom']
const BATCH_C = ['kasrkin', 'novitiates', 'phobos-strike-team', 'corsair-voidscarred', 'warpcoven', 'farstalker-kinband', 'imperial-navy-breachers'] as const

test.use({ viewport: { width: 1280, height: 720 } })

async function prepare(page: Page): Promise<string[]> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mancermundo.settings.v1', JSON.stringify({ animSpeed: 'instant', lowGraphics: true }))
    } catch {
      /* storage unavailable */
    }
  })
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
  tokensSeen: string[]
  errorToasts: number
}

/** Answer the human seat with the random bot until the battle reaches `untilTp` (or ends); report what was seen on the way. */
async function playTo(page: Page, untilTp: number): Promise<Progress> {
  const t0 = Date.now()
  const tokensSeen = new Set<string>()
  let errorToasts = 0
  let last = { tp: 0, phase: '' }
  while (Date.now() - t0 < 150_000) {
    const snap = await page.evaluate(() => {
      const ms = window.__ms!
      const s = ms.getState() as { phase: string; turningPoint: number; operatives: Record<string, { tokens?: { kind: string; count: number }[] }> }
      const toks: string[] = []
      for (const o of Object.values(s.operatives)) for (const t of o.tokens ?? []) if (t.count > 0) toks.push(t.kind)
      return { phase: s.phase, tp: s.turningPoint, toks, errors: ms.toasts().filter((t) => t.kind === 'error').length, mine: (ms.getPending() as { seat: string } | null)?.seat === 'A', settled: ms.settled() }
    })
    last = { tp: snap.tp, phase: snap.phase }
    for (const k of snap.toks) tokensSeen.add(k)
    errorToasts = Math.max(errorToasts, snap.errors)
    if (snap.phase === 'ended' || (snap.phase === 'firefight' && snap.tp >= untilTp && snap.settled && snap.mine)) break
    if (snap.mine && snap.settled) await page.evaluate(() => window.__ms!.autoStep())
    else await page.waitForTimeout(15)
  }
  return { ...last, tokensSeen: [...tokensSeen], errorToasts }
}

for (const team of BATCH_C) {
  test(`${team} plays a battle against an existing team and is screenshotted`, async ({ page }) => {
    test.setTimeout(240_000)
    const errors = await prepare(page)
    const foe = OLD_TEAMS[BATCH_C.indexOf(team) % OLD_TEAMS.length]!
    await page.goto(`./?test=1&bot=normal&seats=human,bot&seed=bc-${team}&mission=secure&layout=01&teams=${foe},${team}&speed=instant`)
    await page.getByTestId('battle').waitFor()
    await page.waitForFunction(() => !!window.__ms?.getState())
    const p = await playTo(page, 3)
    expect(errors).toEqual([])
    expect(p.errorToasts).toBe(0)
    expect(p.phase === 'ended' || p.tp >= 3).toBe(true)
    if (team === 'novitiates') {
      // the Faith pool chip sits in the bot seat's HUD block with its glossary tooltip hook
      const chip = page.getByTestId('hud-pool-B-nv.faith')
      await expect(chip).toBeVisible()
      await expect(chip).toContainText('Faith')
      await expect(chip.locator('[data-keyword="Faith"]')).toHaveCount(1)
    }
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

test('the team builder fields a legal roster for every batch C team, randomises to a legal build and shows the preview', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = await prepare(page)
  await page.goto('./')
  for (const team of BATCH_C) {
    await page.getByTestId('team-A').selectOption(team)
    await page.getByTestId('team-B').selectOption('angels-of-death')
    await page.getByTestId('go-builder').click()
    await expect(page.getByTestId('team-builder')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('builder-ok'), `${team} default`).toBeVisible()
    await expect(page.getByTestId('builder-preview').locator('canvas')).toHaveCount(1)
    for (let i = 0; i < 4; i++) {
      await page.getByTestId('builder-randomise').click()
      await expect(page.getByTestId('builder-ok'), `${team} randomised #${i}`).toBeVisible()
    }
    await page.getByTestId('builder-reset').click()
    await expect(page.getByTestId('builder-ok'), `${team} reset`).toBeVisible()
    await expect(page.getByTestId('builder-continue')).toBeEnabled()
    await page.goto('./')
  }
  expect(errors).toEqual([])
})
