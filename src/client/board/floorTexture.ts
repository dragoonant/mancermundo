// Procedural floor textures for the Zone Mortalis tiles (one 12" x 12" canvas per floor style), built once, deterministic
// (seeded pseudo-random, never Math.random) and cached. Browser only (canvas).
//   plate  : riveted 3" steel plates, scuffs, grime
//   grate  : dark underdeck seen through a bright cross-bar grating
//   hazard : plated deck with a worn yellow/black hazard-stripe frame
// A faint 1" grid (stronger every 6") is drawn on all of them so distances read at a glance.
import { CanvasTexture, SRGBColorSpace } from 'three'

export type FloorStyle = 'grate' | 'plate' | 'hazard'

/** pixels per inch of the 12" tile canvas */
const PPI = 64
const SIZE = 12 * PPI

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function newCanvas(): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  return { canvas, g: canvas.getContext('2d')! }
}

function speckle(g: CanvasRenderingContext2D, rand: () => number, count: number, light = 0.1, dark = 0.14): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${rand() * light})` : `rgba(0,0,0,${rand() * dark})`
    g.fillRect(rand() * SIZE, rand() * SIZE, 1 + rand() * 2, 1 + rand() * 2)
  }
}

function grime(g: CanvasRenderingContext2D, rand: () => number, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * SIZE
    const y = rand() * SIZE
    const r = (0.5 + rand() * 2.2) * PPI
    const b = g.createRadialGradient(x, y, 0, x, y, r)
    b.addColorStop(0, `rgba(0,0,0,${0.12 + rand() * 0.14})`)
    b.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = b
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

function plates(g: CanvasRenderingContext2D, rand: () => number, base: string, platesIn = 3): void {
  g.fillStyle = base
  g.fillRect(0, 0, SIZE, SIZE)
  const p = platesIn * PPI
  for (let y = 0; y < SIZE; y += p) {
    for (let x = 0; x < SIZE; x += p) {
      const t = rand()
      g.fillStyle = `rgba(${t < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rand() * 0.07})`
      g.fillRect(x, y, p, p)
      // bevel: light top/left edge, dark bottom/right edge
      g.fillStyle = 'rgba(255,255,255,0.07)'
      g.fillRect(x, y, p, 2)
      g.fillRect(x, y, 2, p)
      g.fillStyle = 'rgba(0,0,0,0.45)'
      g.fillRect(x, y + p - 3, p, 3)
      g.fillRect(x + p - 3, y, 3, p)
      // corner rivets
      g.fillStyle = 'rgba(150,158,170,0.55)'
      for (const [dx, dy] of [[0.28, 0.28], [platesIn - 0.28, 0.28], [0.28, platesIn - 0.28], [platesIn - 0.28, platesIn - 0.28]] as const) {
        g.beginPath()
        g.arc(x + dx * PPI, y + dy * PPI, PPI * 0.07, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
}

function grid(g: CanvasRenderingContext2D): void {
  for (let i = 0; i <= 12; i++) {
    const strong = i % 6 === 0
    g.strokeStyle = strong ? 'rgba(170,195,220,0.26)' : 'rgba(170,195,220,0.09)'
    g.lineWidth = strong ? 2 : 1
    g.beginPath()
    g.moveTo(i * PPI, 0)
    g.lineTo(i * PPI, SIZE)
    g.stroke()
    g.beginPath()
    g.moveTo(0, i * PPI)
    g.lineTo(SIZE, i * PPI)
    g.stroke()
  }
}

function drawPlate(): HTMLCanvasElement {
  const rand = rng(4_001)
  const { canvas, g } = newCanvas()
  plates(g, rand, '#454b54')
  speckle(g, rand, 5200)
  grime(g, rand, 26)
  grid(g)
  return canvas
}

function drawGrate(): HTMLCanvasElement {
  const rand = rng(9_127)
  const { canvas, g } = newCanvas()
  // deep underdeck
  g.fillStyle = '#16181c'
  g.fillRect(0, 0, SIZE, SIZE)
  // a few glimmers of pipework far below
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(90,60,40,${0.15 + rand() * 0.2})`
    g.fillRect(rand() * SIZE, rand() * SIZE, PPI * (1 + rand() * 3), PPI * 0.3)
  }
  // grating: bars every 0.5" with cross bars every 1.5"; bright top edges
  const bar = PPI * 0.5
  for (let x = 0; x <= SIZE; x += bar) {
    g.fillStyle = '#5a6068'
    g.fillRect(x - 3, 0, 6, SIZE)
    g.fillStyle = 'rgba(190,198,210,0.45)'
    g.fillRect(x - 3, 0, 2, SIZE)
  }
  for (let y = 0; y <= SIZE; y += bar * 3) {
    g.fillStyle = '#4c5158'
    g.fillRect(0, y - 3, SIZE, 6)
    g.fillStyle = 'rgba(190,198,210,0.35)'
    g.fillRect(0, y - 3, SIZE, 2)
  }
  // solid frame every 6"
  for (const c of [0, 6 * PPI, SIZE]) {
    g.fillStyle = '#3b3f46'
    g.fillRect(c - 8, 0, 16, SIZE)
    g.fillRect(0, c - 8, SIZE, 16)
  }
  speckle(g, rand, 1800, 0.12, 0.2)
  grime(g, rand, 12)
  grid(g)
  return canvas
}

function drawHazard(): HTMLCanvasElement {
  const rand = rng(7_733)
  const { canvas, g } = newCanvas()
  plates(g, rand, '#3d434b', 6)
  speckle(g, rand, 4200)
  // hazard frame, inset half an inch from the tile edge, 0.7" wide
  const inset = PPI * 0.5
  const w = PPI * 0.7
  const stripe = PPI * 0.7
  const frame = (x: number, y: number, ww: number, hh: number) => {
    g.save()
    g.beginPath()
    g.rect(x, y, ww, hh)
    g.clip()
    g.fillStyle = '#16171a'
    g.fillRect(x, y, ww, hh)
    for (let k = -SIZE; k < SIZE * 2; k += stripe * 2) {
      g.fillStyle = 'rgba(222,174,38,0.92)'
      g.beginPath()
      g.moveTo(k, y + hh + stripe)
      g.lineTo(k + stripe, y + hh + stripe)
      g.lineTo(k + stripe + hh + stripe * 2, y - stripe)
      g.lineTo(k + hh + stripe * 2, y - stripe)
      g.closePath()
      g.fill()
    }
    g.restore()
  }
  frame(inset, inset, SIZE - inset * 2, w)
  frame(inset, SIZE - inset - w, SIZE - inset * 2, w)
  frame(inset, inset + w, w, SIZE - inset * 2 - w * 2)
  frame(SIZE - inset - w, inset + w, w, SIZE - inset * 2 - w * 2)
  // wear over everything
  for (let i = 0; i < 420; i++) {
    g.fillStyle = `rgba(30,30,34,${0.2 + rand() * 0.4})`
    g.fillRect(inset + rand() * (SIZE - inset * 2), inset + rand() * (SIZE - inset * 2), 1 + rand() * 4, 1 + rand() * 2)
  }
  grime(g, rand, 30)
  grid(g)
  return canvas
}

const cache = new Map<FloorStyle, CanvasTexture>()

/** The canvas texture for a floor style; UV 0..1 covers one whole 12" tile. */
export function floorTexture(style: FloorStyle): CanvasTexture {
  const hit = cache.get(style)
  if (hit) return hit
  const canvas = style === 'grate' ? drawGrate() : style === 'hazard' ? drawHazard() : drawPlate()
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  t.needsUpdate = true
  cache.set(style, t)
  return t
}

/** Hazard-stripe (white / dark) texture used on door panels; a material colour tints the light stripes per door state. */
let hazardStripes: CanvasTexture | null = null
export function hazardStripeTexture(): CanvasTexture {
  if (hazardStripes) return hazardStripes
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#26282c'
  g.fillRect(0, 0, 256, 256)
  const s = 32
  for (let k = -256; k < 512; k += s * 2) {
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.moveTo(k, 256)
    g.lineTo(k + s, 256)
    g.lineTo(k + s + 256, 0)
    g.lineTo(k + 256, 0)
    g.closePath()
    g.fill()
  }
  g.fillStyle = 'rgba(0,0,0,0.25)'
  g.fillRect(0, 0, 256, 6)
  g.fillRect(0, 250, 256, 6)
  hazardStripes = new CanvasTexture(c)
  hazardStripes.colorSpace = SRGBColorSpace
  hazardStripes.anisotropy = 4
  hazardStripes.needsUpdate = true
  return hazardStripes
}
