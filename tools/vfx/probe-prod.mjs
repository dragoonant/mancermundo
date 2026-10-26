// Dev tool: serve dist/ with vite preview for the length of this script and print what a page logs when it loads.
//   node tools/vfx/probe-prod.mjs <path under /mancermundo/>   e.g. vfx.html
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const path = process.argv[2] ?? 'vfx.html'
const port = 4199
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(port), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'ignore', shell: process.platform === 'win32' })
try {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/mancermundo/`)
      if (r.ok) break
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)))
  page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 500), (e.stack ?? '').slice(0, 800)))
  page.on('requestfailed', (r) => console.log('requestfailed', r.url()))
  await page.goto(`http://localhost:${port}/mancermundo/${path}`)
  await page.waitForTimeout(4000)
  console.log('title:', await page.title(), 'canvas:', await page.locator('canvas').count())
  await browser.close()
} finally {
  server.kill()
}
