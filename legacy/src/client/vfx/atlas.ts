// Procedural sprite atlas for the weapon effects: 4 x 4 cells of 128 px drawn with Canvas 2D at start-up, so the
// game ships no binary effect textures. Everything is white (or dark, for scorch and outlines) with alpha; the
// engine tints it per particle. Frame indices are in types.ts (F).
import { F } from './types'

export const ATLAS_CELL = 128
export const ATLAS_COLS = 4
const C = ATLAS_CELL
const H = C / 2

function hash2(x: number, y: number, s: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453
  return n - Math.floor(n)
}
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi, s)
  const b = hash2(xi + 1, yi, s)
  const c = hash2(xi, yi + 1, s)
  const d = hash2(xi + 1, yi + 1, s)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function fbm(x: number, y: number, s: number): number {
  return vnoise(x, y, s) * 0.5 + vnoise(x * 2, y * 2, s + 1) * 0.3 + vnoise(x * 4, y * 4, s + 2) * 0.2
}
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

type Ctx = CanvasRenderingContext2D

function radial(ctx: Ctx, stops: [number, number][], rgb = '255,255,255', radius = H): void {
  const g = ctx.createRadialGradient(H, H, 0, H, H, radius)
  for (const [o, a] of stops) g.addColorStop(o, `rgba(${rgb},${a})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, C, C)
}

/** Per-pixel cell: `f(nx, ny)` with nx, ny in -1..1 returns [r, g, b, a] in 0..1. */
function pixels(ctx: Ctx, f: (nx: number, ny: number) => [number, number, number, number]): void {
  const img = ctx.createImageData(C, C)
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const [r, g, b, a] = f((x + 0.5 - H) / H, (y + 0.5 - H) / H)
      const o = (y * C + x) * 4
      img.data[o] = r * 255
      img.data[o + 1] = g * 255
      img.data[o + 2] = b * 255
      img.data[o + 3] = Math.min(1, Math.max(0, a)) * 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

const DRAW: Record<number, (ctx: Ctx) => void> = {
  [F.GLOW]: (ctx) =>
    radial(ctx, [
      [0, 1],
      [0.12, 0.8],
      [0.3, 0.38],
      [0.55, 0.1],
      [0.8, 0.02],
      [1, 0],
    ]),
  [F.CORE]: (ctx) =>
    radial(ctx, [
      [0, 1],
      [0.1, 1],
      [0.2, 0.75],
      [0.38, 0.22],
      [0.65, 0.05],
      [1, 0],
    ]),
  [F.STAR]: (ctx) => {
    ctx.globalCompositeOperation = 'lighter'
    radial(ctx, [
      [0, 1],
      [0.1, 0.9],
      [0.28, 0.25],
      [0.6, 0.03],
      [1, 0],
    ])
    const spike = (len: number, thin: number, rot: number, a: number) => {
      ctx.save()
      ctx.translate(H, H)
      ctx.rotate(rot)
      ctx.scale(1, thin)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len)
      g.addColorStop(0, `rgba(255,255,255,${a})`)
      g.addColorStop(0.35, `rgba(255,255,255,${a * 0.45})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, len, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    spike(62, 0.07, 0, 1)
    spike(62, 0.07, Math.PI / 2, 1)
    spike(40, 0.06, Math.PI / 4, 0.55)
    spike(40, 0.06, -Math.PI / 4, 0.55)
  },
  [F.SMOKE]: (ctx) =>
    pixels(ctx, (nx, ny) => {
      const d = Math.hypot(nx, ny)
      const n = fbm(nx * 2.6 + 4, ny * 2.6 + 9, 3)
      const body = smooth(1, 0.15, d + (n - 0.5) * 0.9)
      const shade = 0.72 + 0.28 * (1 - (nx * 0.5 + ny * 0.5 + 1) / 2) // lit from the top left
      const v = shade * (0.8 + 0.2 * n)
      return [v, v, v, body * (0.75 + 0.25 * n)]
    }),
  [F.RING]: (ctx) =>
    radial(ctx, [
      [0, 0],
      [0.72, 0],
      [0.82, 0.5],
      [0.88, 1],
      [0.94, 0.45],
      [1, 0],
    ]),
  [F.SPARK]: (ctx) =>
    radial(ctx, [
      [0, 1],
      [0.3, 1],
      [0.5, 0.35],
      [0.8, 0.04],
      [1, 0],
    ]),
  [F.FLAME]: (ctx) =>
    pixels(ctx, (nx, ny) => {
      // teardrop pointing up: t runs 0 (base) to 1 (tip)
      const t = (0.85 - ny) / 1.75
      if (t < 0 || t > 1) return [1, 1, 1, 0]
      const wob = (fbm(nx * 2.2 + 11, ny * 2.2 + 3, 5) - 0.5) * 0.5
      const halfW = Math.sin(Math.PI * Math.pow(t, 0.7)) * (0.62 - t * 0.28) + wob * t
      const d = Math.abs(nx) / Math.max(0.02, halfW)
      const body = smooth(1, 0.2, d)
      const core = smooth(0.55, 0, d) * smooth(1, 0.1, t)
      const a = body * (0.55 + 0.45 * (1 - t)) * (0.8 + 0.2 * fbm(nx * 3, ny * 3, 8))
      const v = 0.75 + 0.25 * core
      return [v, v, v, Math.min(1, a + core * 0.4)]
    }),
  [F.SLASH]: (ctx) => {
    ctx.clearRect(0, 0, C, C)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // three tapered claw cuts, top left to bottom right
    const cut = (ox: number, oy: number, bend: number, wmax: number) => {
      const x0 = 14 + ox
      const y0 = 18 + oy
      const x1 = 114 + ox
      const y1 = 110 + oy
      const mx = (x0 + x1) / 2 + bend
      const my = (y0 + y1) / 2 - bend
      const pts: [number, number, number][] = []
      const N = 22
      for (let i = 0; i <= N; i++) {
        const t = i / N
        const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1
        const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1
        pts.push([x, y, wmax * Math.pow(Math.sin(Math.PI * t), 0.75)])
      }
      const path = (grow: number) => {
        ctx.beginPath()
        const nrm = (i: number): [number, number] => {
          const a = pts[Math.max(0, i - 1)]!
          const b = pts[Math.min(N, i + 1)]!
          const dx = b[0] - a[0]
          const dy = b[1] - a[1]
          const l = Math.hypot(dx, dy) || 1
          return [-dy / l, dx / l]
        }
        for (let i = 0; i <= N; i++) {
          const [nx, ny] = nrm(i)
          const w = pts[i]![2] + grow
          i === 0 ? ctx.moveTo(pts[i]![0] + nx * w, pts[i]![1] + ny * w) : ctx.lineTo(pts[i]![0] + nx * w, pts[i]![1] + ny * w)
        }
        for (let i = N; i >= 0; i--) {
          const [nx, ny] = nrm(i)
          const w = pts[i]![2] + grow
          ctx.lineTo(pts[i]![0] - nx * w, pts[i]![1] - ny * w)
        }
        ctx.closePath()
      }
      path(3.2)
      ctx.fillStyle = 'rgba(20,0,0,1)'
      ctx.fill()
      path(0)
      ctx.fillStyle = 'rgba(255,255,255,1)'
      ctx.fill()
    }
    cut(-20, 6, 8, 7.5)
    cut(0, 0, 12, 9.5)
    cut(20, -6, 9, 7)
    // flicked droplets
    ctx.fillStyle = 'rgba(255,255,255,1)'
    for (const [x, y, r] of [[96, 30, 3.4], [106, 44, 2.4], [30, 96, 3], [22, 108, 2]] as const) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  },
  [F.BASH]: (ctx) => {
    ctx.clearRect(0, 0, C, C)
    ctx.lineJoin = 'round'
    const star = (inner: number, outer: number, n: number, grow: number, jitter: number) => {
      ctx.beginPath()
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2 + 0.2
        const r = (i % 2 === 0 ? outer * (1 - jitter * ((i * 7) % 5) * 0.05) : inner) + grow
        const x = H + Math.cos(a) * r
        const y = H + Math.sin(a) * r
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.closePath()
    }
    star(24, 58, 11, 3.5, 1)
    ctx.fillStyle = 'rgba(20,0,0,1)'
    ctx.fill()
    star(24, 58, 11, 0, 1)
    ctx.fillStyle = 'rgba(255,255,255,1)'
    ctx.fill()
    // dark core ring so it reads as a symbol, not a blob
    ctx.beginPath()
    ctx.arc(H, H, 17, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(70,0,0,0.9)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(H, H, 9, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,1)'
    ctx.fill()
    // crack lines
    ctx.strokeStyle = 'rgba(20,0,0,0.9)'
    ctx.lineWidth = 2.2
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.55
      ctx.beginPath()
      ctx.moveTo(H + Math.cos(a) * 26, H + Math.sin(a) * 26)
      ctx.lineTo(H + Math.cos(a + 0.12) * 44, H + Math.sin(a + 0.12) * 44)
      ctx.stroke()
    }
  },
  [F.DEBRIS]: (ctx) => {
    ctx.clearRect(0, 0, C, C)
    const pts: [number, number][] = []
    const N = 8
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const r = 34 + hash2(i, 4, 9) * 26
      pts.push([H + Math.cos(a) * r, H + Math.sin(a) * r])
    }
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
    const g = ctx.createLinearGradient(20, 20, 108, 108)
    g.addColorStop(0, 'rgba(235,235,235,1)')
    g.addColorStop(1, 'rgba(90,90,90,1)')
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = 'rgba(40,40,40,1)'
    ctx.lineWidth = 3
    ctx.stroke()
  },
  [F.SCORCH]: (ctx) =>
    pixels(ctx, (nx, ny) => {
      const d = Math.hypot(nx, ny)
      const n = fbm(nx * 3.2 + 2, ny * 3.2 + 7, 12)
      const a = smooth(1, 0.12, d + (n - 0.5) * 0.7) * (0.55 + 0.45 * smooth(0.95, 0.3, d))
      const streak = 0.85 + 0.15 * fbm(Math.atan2(ny, nx) * 5, d * 2, 4)
      return [0.1 * streak, 0.09 * streak, 0.08 * streak, a]
    }),
  [F.HEX]: (ctx) =>
    pixels(ctx, (nx, ny) => {
      const d = Math.hypot(nx, ny)
      if (d > 1) return [1, 1, 1, 0]
      // hex cells: distance to the nearest cell edge in a pointy hex grid
      const s = 5.2
      const px = nx * s
      const py = ny * s * 1.1547
      const q = [
        [0, 0],
        [1, 0],
      ]
      void q
      const ax = px / 1.5
      const ay = py - 0.5 * (Math.floor(ax) % 2 ? 1 : 0)
      const fx = ax - Math.floor(ax) - 0.5
      const fy = ay - Math.floor(ay) - 0.5
      const e = Math.max(Math.abs(fx) * 1.1, Math.abs(fy) * 1.0, (Math.abs(fx) * 0.55 + Math.abs(fy) * 0.85))
      const line = smooth(0.34, 0.5, e)
      const rim = smooth(0.72, 0.97, d) * smooth(1, 0.94, d)
      const fill = 0.1 + 0.2 * (1 - d)
      return [1, 1, 1, Math.min(1, fill + line * 0.55 * smooth(1, 0.3, d) + rim * 0.9)]
    }),
  [F.BEAM]: (ctx) =>
    pixels(ctx, (_nx, ny) => {
      const v = Math.abs(ny)
      const a = Math.pow(Math.max(0, 1 - v), 2.2)
      return [1, 1, 1, a]
    }),
  [F.EDGE]: (ctx) =>
    pixels(ctx, (_nx, ny) => {
      const v = Math.abs(ny)
      const core = smooth(0.55, 0.0, v)
      const halo = Math.pow(Math.max(0, 1 - v), 3) * 0.45
      return [1, 1, 1, Math.min(1, core + halo)]
    }),
  [F.DROP]: (ctx) => {
    ctx.clearRect(0, 0, C, C)
    ctx.beginPath()
    ctx.moveTo(H, 14)
    ctx.bezierCurveTo(H + 6, 44, H + 36, 62, H + 36, 84)
    ctx.arc(H, 84, 36, 0, Math.PI, false)
    ctx.bezierCurveTo(H - 36, 62, H - 6, 44, H, 14)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,255,255,1)'
    ctx.fill()
  },
  [F.BLADE]: (ctx) => {
    ctx.clearRect(0, 0, C, C)
    // knife pointing right: blade, guard, grip
    const g = ctx.createLinearGradient(0, 56, 0, 72)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(150,170,190,1)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(44, 54)
    ctx.lineTo(112, 62)
    ctx.lineTo(44, 72)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.fillRect(38, 48, 8, 30)
    ctx.fillStyle = 'rgba(200,200,200,0.9)'
    ctx.fillRect(10, 58, 28, 10)
  },
}

/** Draw the whole atlas onto a fresh canvas (browser only). */
export function drawAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = ATLAS_CELL * ATLAS_COLS
  const main = canvas.getContext('2d')!
  const cell = document.createElement('canvas')
  cell.width = cell.height = C
  const cx = cell.getContext('2d', { willReadFrequently: true })!
  for (let f = 0; f < ATLAS_COLS * ATLAS_COLS; f++) {
    const draw = DRAW[f]
    if (!draw) continue
    cx.setTransform(1, 0, 0, 1, 0, 0)
    cx.globalCompositeOperation = 'source-over'
    cx.clearRect(0, 0, C, C)
    draw(cx)
    main.drawImage(cell, (f % ATLAS_COLS) * C, Math.floor(f / ATLAS_COLS) * C)
  }
  return canvas
}
