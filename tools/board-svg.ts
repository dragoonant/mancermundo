/**
 * npx tsx tools/board-svg.ts [board-id ...]
 *
 * Renders every Zone Mortalis board (or the ids given) to tools/out/boards/<id>.svg: tile squares, walls, doors (locked ones in
 * red), terminals, ductways, obstacles, casket spots, the deployment regions of the scenarios the board lists, and a 1" grid.
 * The picture is drawn from the compiled BoardDef, so it shows exactly the geometry the rules measure. Top of the picture is
 * low z (seat A's end of a 2x3 board); x runs to the right, z down the page, as seen from above in the 3D view.
 * Stage S2 adds `--sim <seed>` (fighters, arcs and move paths of a simulated game).
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadBundle } from '../src/data'
import { compileBoard, deploymentRegions, fitBases, initialDoors, SMALL_BASE_RADIUS } from '../src/engine/board'
import type { BoardDef, Polygon } from '../src/engine/types'

const PX = 22 // pixels per inch
const PAD = 2.5 // inches of margin around the board
const OUT = path.resolve(import.meta.dirname, 'out/boards')

const KIND_FILL: Record<string, string> = { barricade: '#9a7b4f', crates: '#6f8f6a', barrels: '#8a6fa0', pipes: '#6a8fa0' }
const FLOOR_FILL: Record<string, string> = { grate: '#2c3138', plate: '#33363d', hazard: '#3b3526' }

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const num = (n: number) => (Math.round(n * 100) / 100).toString()

function poly(points: Polygon, attrs: string): string {
  return `<polygon points="${points.map((p) => `${num(p.x)},${num(p.z)}`).join(' ')}" ${attrs}/>`
}

function svgFor(def: BoardDef, scenarioLabels: string[], regionLayers: string[], title: string): string {
  const { minX, maxX, minZ, maxZ } = def.bounds
  const w = maxX - minX + PAD * 2
  const h = maxZ - minZ + PAD * 2
  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(minX - PAD)} ${num(minZ - PAD)} ${num(w)} ${num(h + 4)}" width="${Math.round(w * PX)}" height="${Math.round((h + 4) * PX)}" font-family="Segoe UI, Helvetica, Arial, sans-serif">`)
  out.push(`<rect x="${num(minX - PAD)}" y="${num(minZ - PAD)}" width="${num(w)}" height="${num(h + 4)}" fill="#14161a"/>`)
  out.push(`<title>${esc(title)}</title>`)

  // tile floors
  for (const t of def.tiles) out.push(poly(t.rect, `fill="${FLOOR_FILL[t.floor] ?? '#2f3238'}"`))

  // 1" grid, heavier every 6"
  for (let x = Math.ceil(minX); x <= maxX; x++) {
    const major = x % 6 === 0
    out.push(`<line x1="${x}" y1="${minZ}" x2="${x}" y2="${maxZ}" stroke="${major ? '#5a606b' : '#444a54'}" stroke-width="${major ? 0.05 : 0.02}" stroke-opacity="0.55"/>`)
  }
  for (let z = Math.ceil(minZ); z <= maxZ; z++) {
    const major = z % 6 === 0
    out.push(`<line x1="${minX}" y1="${z}" x2="${maxX}" y2="${z}" stroke="${major ? '#5a606b' : '#444a54'}" stroke-width="${major ? 0.05 : 0.02}" stroke-opacity="0.55"/>`)
  }

  // deployment regions (under everything solid)
  out.push(...regionLayers)

  // tile outlines and ids
  for (const t of def.tiles) {
    out.push(poly(t.rect, 'fill="none" stroke="#7d8696" stroke-width="0.08" stroke-dasharray="0.6 0.4"'))
    out.push(`<text x="${num(t.centre.x)}" y="${num(t.centre.z + 0.35)}" font-size="1.1" fill="#8e97a6" fill-opacity="0.45" text-anchor="middle">${t.tileId.replace('zm.t.', '')} ${t.rot}</text>`)
  }

  // obstacles
  for (const o of def.obstacles) out.push(poly(o.poly, `fill="${KIND_FILL[o.kind] ?? '#888'}" stroke="#d8d2c0" stroke-width="0.05"`))

  // ductways
  for (const u of def.ducts) {
    out.push(`<line x1="${num(u.a.x)}" y1="${num(u.a.z)}" x2="${num(u.b.x)}" y2="${num(u.b.z)}" stroke="#4fd1d9" stroke-width="0.22" stroke-linecap="round"/>`)
    out.push(`<circle cx="${num(u.a.x)}" cy="${num(u.a.z)}" r="0.3" fill="none" stroke="#4fd1d9" stroke-width="0.09"/>`)
    out.push(`<circle cx="${num(u.b.x)}" cy="${num(u.b.z)}" r="0.3" fill="none" stroke="#4fd1d9" stroke-width="0.09"/>`)
  }

  // walls
  for (const wl of def.walls) out.push(poly(wl.poly, 'fill="#aab1bd" stroke="#e7ebf2" stroke-width="0.04"'))

  // doors
  for (const d of def.doors) {
    out.push(poly(d.poly, `fill="${d.lockedAtStart ? '#d8403a' : '#e39b2f'}" stroke="#fff" stroke-width="0.05"`))
    out.push(`<text x="${num((d.seg.a.x + d.seg.b.x) / 2)}" y="${num((d.seg.a.z + d.seg.b.z) / 2 + 0.28)}" font-size="0.8" fill="#14161a" text-anchor="middle" font-weight="700">${d.lockedAtStart ? 'L' : 'D'}</text>`)
    for (const m of d.terminals) out.push(`<rect x="${num(m.pos.x - 0.3)}" y="${num(m.pos.z - 0.3)}" width="0.6" height="0.6" fill="#4a8cff" stroke="#fff" stroke-width="0.05"/>`)
  }

  // casket spots (1" discs)
  for (const s of def.casketSpots) out.push(`<circle cx="${num(s.x)}" cy="${num(s.z)}" r="0.5" fill="#f2c94c" fill-opacity="0.85" stroke="#fff" stroke-width="0.05"/>`)

  // axis labels every 6"
  for (let x = Math.ceil(minX / 6) * 6; x <= maxX; x += 6) out.push(`<text x="${x}" y="${num(minZ - 0.8)}" font-size="0.9" fill="#9aa3b2" text-anchor="middle">${x}</text>`)
  for (let z = Math.ceil(minZ / 6) * 6; z <= maxZ; z += 6) out.push(`<text x="${num(minX - 0.6)}" y="${num(z + 0.3)}" font-size="0.9" fill="#9aa3b2" text-anchor="end">${z}</text>`)

  // caption and legend
  const cy = maxZ + PAD + 0.2
  out.push(`<text x="${num(minX - PAD + 0.6)}" y="${num(cy)}" font-size="1.2" fill="#e7ebf2" font-weight="700">${esc(title)}</text>`)
  out.push(`<text x="${num(minX - PAD + 0.6)}" y="${num(cy + 1.4)}" font-size="0.85" fill="#9aa3b2">${esc(scenarioLabels.join('  |  '))}  |  walls ${def.walls.length}, doors ${def.doors.length}, ducts ${def.ducts.length}, obstacles ${def.obstacles.length}, casket spots ${def.casketSpots.length}</text>`)
  out.push(`<text x="${num(minX - PAD + 0.6)}" y="${num(cy + 2.6)}" font-size="0.85" fill="#9aa3b2">D door  L locked door (blue squares: terminals)  cyan: ductway  gold: casket spot  1" grid, heavy every 6"; top = low z (seat A end)</text>`)
  out.push('</svg>')
  return out.join('\n')
}

function main(): void {
  const bundle = loadBundle()
  const want = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const ids = Object.keys(bundle.boards).sort()
  const chosen = want.length > 0 ? ids.filter((id) => want.some((w) => id === w || id.endsWith(`.${w}`))) : ids
  if (chosen.length === 0) {
    console.error(`no board matches ${want.join(', ')}; boards: ${ids.join(', ')}`)
    process.exit(1)
  }
  fs.mkdirSync(OUT, { recursive: true })
  for (const id of chosen) {
    const board = bundle.boards[id]!
    const def = compileBoard(board, bundle.tiles)
    const doors = initialDoors(def)
    const layers: string[] = []
    const labels: string[] = []
    const shown = new Set<string>()
    for (const sid of board.scenarios) {
      const s = bundle.scenarios[sid]
      if (!s) continue
      labels.push(s.name)
      const reg = deploymentRegions(def, s.deployment)
      const key = JSON.stringify(reg)
      if (shown.has(key)) continue
      shown.add(key)
      if (reg.kind === 'standard') {
        for (const [polys, colour] of [[reg.low, '#3d7bff'], [reg.high, '#ff5d5d']] as const) {
          for (const p of polys) layers.push(poly(p, `fill="${colour}" fill-opacity="0.16" stroke="${colour}" stroke-opacity="0.5" stroke-width="0.06"`))
          for (const c of fitBases(def, doors, polys, SMALL_BASE_RADIUS, 10)) layers.push(`<circle cx="${num(c.x)}" cy="${num(c.z)}" r="${SMALL_BASE_RADIUS}" fill="${colour}" fill-opacity="0.45"/>`)
        }
      } else {
        for (const polys of Object.values(reg.tiles)) for (const p of polys) layers.push(poly(p, 'fill="#4ad66d" fill-opacity="0.16" stroke="#4ad66d" stroke-opacity="0.5" stroke-width="0.06"'))
      }
    }
    const file = path.join(OUT, `${id}.svg`)
    fs.writeFileSync(file, svgFor(def, labels, layers, `${board.name} (${board.id}, ${board.layout})`))
    console.log(path.relative(process.cwd(), file))
  }
}

main()
