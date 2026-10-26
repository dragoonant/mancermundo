// Dev tool: fire effects in the vfx.html gallery under headless Chromium (the in-app browser throttles frames when
// hidden) and write frozen mid-effect screenshots.
//   node tools/vfx/shoot.mjs <base url> <outdir> <job> [<job> ...]
//   job = <weapon id | x-button id>:<hit|miss|crit|mixed>:<ms after first spawn>[:<camera distance>[:<shooter distance>[:<focus x>]]]
//   e.g. node tools/vfx/shoot.mjs http://localhost:5190 e2e-out/tune kom.w.rokkit-launcha-aimed:hit:560:18
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const [base, outDir, ...jobs] = process.argv.slice(2)
if (!base || !outDir || jobs.length === 0) {
  console.error('usage: node tools/vfx/shoot.mjs <base url> <outdir> <job>...')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
const shots = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await page.goto(`${base}/vfx.html${process.env.FX ? `?fx=${process.env.FX}` : ''}`)
await page.getByTestId('vfx-canvas').waitFor()
await page.waitForFunction(() => !!window.__gallery && !!window.__vfx)
for (const job of jobs) {
  const [id, hit = 'hit', ms = '200', cam = '30', dist = '10', focus = '0'] = job.split(':')
  await page.evaluate(() => {
    window.__vfx.resume()
    document.querySelector('[data-testid="x-clear"]').click()
  })
  await page.waitForTimeout(80)
  await page.evaluate(
    ([hit, cam, dist]) => {
      const q = (t) => document.querySelector(`[data-testid="${t}"]`)
      q(`hit-${hit}`)?.click()
      const d = Number(dist)
      const slider = document.querySelector('input[type=range]')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(slider, String(d))
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    },
    [hit, cam, dist],
  )
  await page.waitForTimeout(120)
  await page.evaluate(([cam, focus]) => window.__gallery.camera(Number(cam), Number(focus), 0.4), [cam, focus])
  await page.waitForTimeout(80)
  await page.evaluate(
    ([id, ms]) => {
      window.__vfx.resume()
      window.__vfx.freezeAfterNextSpawn(Number(ms))
      const q = (t) => document.querySelector(`[data-testid="${t}"]`)
      ;(q(`fire-${id}`) ?? q(id)).click()
    },
    [id, ms],
  )
  await page.waitForFunction(() => window.__vfx.frozen(), null, { timeout: 8000 })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.waitForTimeout(150)
  const stats = await page.evaluate(() => window.__vfx.stats())
  const file = `${outDir}/${id.replace(/[^a-z0-9.-]/gi, '_')}-${hit}-${ms}.png`
  const buf = await page.screenshot({ path: file, clip: { x: 350, y: 0, width: 930, height: 720 } })
  shots.push({ file, buf, label: `${id} ${hit} ${ms}ms` })
  console.log(file, `live ${stats.live} add ${stats.add} norm ${stats.norm} spark ${stats.spark} beams ${stats.beamAdd + stats.beamNorm} dropped ${stats.dropped}`)
}
if (process.env.SHEET && shots.length > 1) {
  // contact sheet: all shots in a grid, scaled, for a quick comparison
  const cols = Number(process.env.COLS ?? 2)
  const scale = Number(process.env.SCALE ?? 0.62)
  const sheet = await browser.newPage({ viewport: { width: Math.round(930 * scale * cols) + 4, height: Math.round(720 * scale * Math.ceil(shots.length / cols)) } })
  const html = shots.map((s) => `<div style="position:relative;display:inline-block;width:${930 * scale}px;height:${720 * scale}px"><img src="data:image/png;base64,${s.buf.toString('base64')}" style="width:100%;height:100%"/><span style="position:absolute;left:6px;top:4px;color:#ff0;font:12px monospace">${s.label}</span></div>`).join('')
  await sheet.setContent(`<body style="margin:0;background:#000;line-height:0">${html}</body>`)
  await sheet.screenshot({ path: `${outDir}/sheet.png` })
  console.log(`${outDir}/sheet.png`)
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
