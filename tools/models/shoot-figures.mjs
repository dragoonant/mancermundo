// QC contact screenshots of ?gallery per team (bodies with sockets, then the team's attachment pages).
//   node tools/models/shoot-figures.mjs [baseUrl] [team ...]     e.g. http://localhost:5199/  pf ht pm wb
// Needs a running dev server (npm run dev) and the Playwright chromium; writes tools/out/screens/figures-<team>.png
// (bodies, front) and figures-<team>-3q.png / figures-<team>-att.png.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = process.argv[2] && process.argv[2].startsWith('http') ? process.argv[2] : 'http://localhost:5199/'
const want = process.argv.slice(process.argv[2] && process.argv[2].startsWith('http') ? 3 : 2)
// team index in the gallery's team list, attachment page id
const TEAMS = {
  pf: { name: 'figures-pathfinders', teamId: 'pathfinders', att: 'att-pf' },
  ht: { name: 'figures-hierotek-circle', teamId: 'hierotek-circle', att: 'att-ht' },
  pm: { name: 'figures-plague-marines', teamId: 'plague-marines', att: 'att-pm' },
  wb: { name: 'figures-wyrmblade', teamId: 'wyrmblade', att: 'att-wb' },
  aod: { name: 'figures-angels-of-death', teamId: 'angelsofdeath', att: 'att-aod' },
    lg: { name: 'figures-legionaries', teamId: 'legionaries', att: 'att-lg' },
  ha: { name: 'figures-hand-of-the-archon', teamId: 'handofthearchon', att: 'att-ha' },
  hc: { name: 'figures-hunter-clade', teamId: 'hunterclade', att: 'att-hc' },
  hk: { name: 'figures-hearthkyn-salvagers', teamId: 'hearthkynsalvagers', att: 'att-hk' },
  // M10 v2 bodies (batches C and D): the screenshot is v2-<prefix>.png, no attachment page
  ks: { name: 'v2-ks', teamId: 'kasrkin' },
  nv: { name: 'v2-nv', teamId: 'novitiates' },
  ph: { name: 'v2-ph', teamId: 'phobosstriketeam' },
  cv: { name: 'v2-cv', teamId: 'corsairvoidscarred' },
  wc: { name: 'v2-wc', teamId: 'warpcoven' },
  fk: { name: 'v2-fk', teamId: 'farstalkerkinband' },
  nb: { name: 'v2-nb', teamId: 'imperialnavybreachers' },
  bl: { name: 'v2-bl', teamId: 'blooded' },
  fg: { name: 'v2-fg', teamId: 'fellgorravagers' },
  cc: { name: 'v2-cc', teamId: 'chaoscult' },
  gm: { name: 'v2-gm', teamId: 'goremongers' },
  ss: { name: 'v2-ss', teamId: 'scoutsquad' },
  ta: { name: 'v2-ta', teamId: 'tempestusaquilons' },
  ex: { name: 'v2-ex', teamId: 'exactionsquad' },
}
const out = 'tools/out/screens'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 2200, height: 1250 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${base}?gallery`)
await page.getByTestId('gallery').waitFor()
const settle = async () => {
  await page.waitForTimeout(2500)
  await page.waitForFunction(() => window.__ms?.glbStats?.('bodies/')?.failed === 0)
}
const teamIndex = async (id) =>
  page.evaluate((tid) => [...document.querySelectorAll('[data-testid^="team-"]')].map((e) => e.getAttribute('data-testid')).filter((t) => t !== 'team-all').indexOf(`team-${tid}`), id)
if (process.env.SOCKETS === '1') await page.getByTestId('toggle-sockets').click()
for (const key of want.length ? want : Object.keys(TEAMS)) {
  if (key === 'all') {
    await page.getByTestId('team-all').click()
    await page.getByTestId('att-off').click()
    await page.getByTestId('view-front').click()
    await page.waitForTimeout(4000)
    await page.mouse.move(1100, 650)
    await page.mouse.wheel(0, 900)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${out}/figures-all.png` })
    continue
  }
  const t = TEAMS[key]
  // the team buttons are numbered by position in teamList; find the one whose text matches
  const buttons = await page.$$('[data-testid^="team-"]')
  let clicked = false
  for (const b of buttons) {
    const id = await b.getAttribute('data-testid')
    if (id === 'team-all') continue
    const label = (await b.textContent()) ?? ''
    if (label.toLowerCase().replace(/[^a-z]/g, '').includes(t.teamId.replace(/-/g, '').slice(0, 6))) {
      await b.click()
      clicked = true
      break
    }
  }
  if (!clicked) throw new Error(`no gallery button for ${t.teamId}`)
  await page.getByTestId('att-off').click()
  await page.getByTestId('view-front').click()
  await settle()
  await page.mouse.move(1100, 650)
  await page.mouse.wheel(0, Number(process.env.ZOOM ?? 400))
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/${t.name}.png` })
  await page.getByTestId('view-three-quarter').click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${t.name}-3q.png` })
  if (t.att) {
    await page.getByTestId(t.att).click()
    await page.getByTestId('view-front').click()
    await page.waitForTimeout(3500)
    await page.screenshot({ path: `${out}/${t.name}-att.png` })
  }
  console.log('shot', t.name)
}
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
