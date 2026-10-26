// Texture for the Zone Mortalis bulkheads (the wall rectangles): dark gunmetal plating with recessed panel seams, rivet rows,
// a worn hazard-stripe band at the foot and a lighter lip under the top edge. One canvas tile spans WALL_TILE_W inches along
// the wall and the full wall height (WALL_HEIGHT) up it; the wall geometry in zmGeometry.ts has UVs in those units.
// Deterministic (seeded pseudo-random, never Math.random), built once and cached. Browser only (canvas).
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

const W = 384
const H = 384

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

let wall: CanvasTexture | null = null

export function wallTexture(): CanvasTexture {
  if (wall) return wall
  const rand = rng(40_017)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')!
  // canvas y runs top to bottom, the top of the canvas is the top of the wall
  const t = rand()
  g.fillStyle = `rgb(${66 + t * 8},${72 + t * 8},${82 + t * 8})`
  g.fillRect(0, 0, W, H)
  // vertical brushed streaks
  for (let i = 0; i < 140; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)'
    g.fillRect(rand() * W, 0, 1 + rand() * 3, H)
  }
  // grime running down from the top
  for (let i = 0; i < 18; i++) {
    const x = rand() * W
    const len = 40 + rand() * 220
    const grad = g.createLinearGradient(0, 0, 0, len)
    grad.addColorStop(0, `rgba(10,10,12,${0.2 + rand() * 0.2})`)
    grad.addColorStop(1, 'rgba(10,10,12,0)')
    g.fillStyle = grad
    g.fillRect(x, 0, 2 + rand() * 9, len)
  }
  // lighter lip under the top edge
  g.fillStyle = 'rgba(190,200,215,0.22)'
  g.fillRect(0, 0, W, 10)
  g.fillStyle = 'rgba(0,0,0,0.5)'
  g.fillRect(0, 10, W, 3)
  // recessed panel seams at the tile edges and across the middle of the wall height
  g.fillStyle = 'rgba(8,9,12,0.85)'
  g.fillRect(0, 0, 5, H)
  g.fillRect(W - 5, 0, 5, H)
  g.fillRect(0, H * 0.46, W, 4)
  g.fillStyle = 'rgba(200,210,225,0.18)'
  g.fillRect(5, 0, 2, H)
  g.fillRect(0, H * 0.46 + 4, W, 2)
  // rivet rows
  const rivet = (cx: number, cy: number) => {
    g.fillStyle = 'rgba(0,0,0,0.55)'
    g.beginPath()
    g.arc(cx + 1.5, cy + 1.5, 4.2, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = 'rgb(128,136,148)'
    g.beginPath()
    g.arc(cx, cy, 3.6, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.beginPath()
    g.arc(cx - 1, cy - 1, 1.4, 0, Math.PI * 2)
    g.fill()
  }
  for (let i = 0; i < 6; i++) {
    const x = 24 + (i * (W - 48)) / 5
    rivet(x, 30)
    rivet(x, H * 0.46 - 14)
    rivet(x, H * 0.46 + 20)
  }
  // hazard-stripe band at the foot (bottom 18% of the wall)
  const bandH = Math.round(H * 0.18)
  const y0 = H - bandH
  g.save()
  g.beginPath()
  g.rect(0, y0, W, bandH)
  g.clip()
  g.fillStyle = '#17181b'
  g.fillRect(0, y0, W, bandH)
  const s = bandH
  for (let k = -H; k < W + H; k += s * 2) {
    g.fillStyle = 'rgba(214,168,38,0.9)'
    g.beginPath()
    g.moveTo(k, H)
    g.lineTo(k + s, H)
    g.lineTo(k + s + bandH, y0)
    g.lineTo(k + bandH, y0)
    g.closePath()
    g.fill()
  }
  g.restore()
  g.fillStyle = 'rgba(0,0,0,0.5)'
  g.fillRect(0, y0 - 3, W, 3)
  // scuffs
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.16)'
    g.fillRect(rand() * W, rand() * H, 1 + rand() * 3, 1 + rand() * 2)
  }
  wall = new CanvasTexture(canvas)
  wall.wrapS = RepeatWrapping
  wall.wrapT = RepeatWrapping
  wall.colorSpace = SRGBColorSpace
  wall.anisotropy = 8
  wall.needsUpdate = true
  return wall
}
