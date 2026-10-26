// First-load budget: the start screen ships without three.js, react-three-fiber or the battle scene (lazy chunks),
// and the ?fps overlay shows on the battle canvas.
import { expect, test } from '@playwright/test'
import { startBattle } from './helpers'

test('the entry HTML preloads no 3D chunk; the battle chunks load on demand', async ({ page, request }) => {
  const html = await (await request.get('./')).text()
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1]!)
  expect(refs.length).toBeGreaterThan(2)
  expect(refs.filter((l) => /three|r3f|BattleScreen|TeamBuilder|Gallery|decider|worker/.test(l))).toEqual([])
  // the AI worker is created only when a bot has to answer
  const loaded: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('.js')) loaded.push(r.url().split('/').pop()!)
  })
  await page.goto('./')
  await expect(page.getByTestId('title')).toBeVisible()
  expect(loaded.filter((l) => l.startsWith('worker-'))).toEqual([])
})

test('?fps shows the render overlay on the battle canvas', async ({ page }) => {
  await startBattle(page, '?test=1&fps&seats=human,bot&seed=e2e-1&teams=aod,kom&speed=instant')
  const o = page.getByTestId('fps-overlay')
  await expect(o).toBeVisible()
  await expect(o).toContainText(/fps/)
  await expect(o).toContainText(/calls \d+/)
})
