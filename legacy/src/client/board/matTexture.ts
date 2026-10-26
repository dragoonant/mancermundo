// Killzone mat on a canvas. First paint is the procedural dark-industrial mat (plated steel floor, seams every 6 inches,
// rivets, grime, scorch marks); then the chosen generated texture (mats.ts, public/assets/mats) is tiled over it once
// loaded. Either way the killzone edge markings and the 1" grid are drawn on top. Browser only.
import { CanvasTexture, SRGBColorSpace } from 'three'
import { useGame } from '../store/game'
import { repaintBoard } from './cameraApi'
import { chooseMat, getMatPref, type MatDef } from './mats'

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** Killzone edge markings (hazard stripes along the long edges) and the subtle 1" grid, stronger every 6". */
function drawOverlay(g: CanvasRenderingContext2D, widthIn: number, heightIn: number, pxPerInch: number): void {
  const W = Math.round(widthIn * pxPerInch)
  const H = Math.round(heightIn * pxPerInch)
  // hazard stripes along the long edges
  const stripe = pxPerInch * 0.5
  g.save()
  g.beginPath()
  g.rect(0, 0, W, stripe)
  g.rect(0, H - stripe, W, stripe)
  g.clip()
  for (let x = -H; x < W + H; x += stripe * 2) {
    g.fillStyle = 'rgba(214,170,40,0.55)'
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x + stripe, 0)
    g.lineTo(x + stripe - H, H)
    g.lineTo(x - H, H)
    g.closePath()
    g.fill()
  }
  g.restore()
  // 1" grid, stronger every 6"
  for (let i = 0; i <= widthIn; i++) {
    g.strokeStyle = i % 6 === 0 ? 'rgba(160,185,210,0.34)' : 'rgba(160,185,210,0.14)'
    g.lineWidth = i % 6 === 0 ? 2 : 1
    g.beginPath()
    g.moveTo(i * pxPerInch, 0)
    g.lineTo(i * pxPerInch, H)
    g.stroke()
  }
  for (let j = 0; j <= heightIn; j++) {
    g.strokeStyle = j % 6 === 0 || j === heightIn / 2 ? 'rgba(160,185,210,0.34)' : 'rgba(160,185,210,0.14)'
    g.lineWidth = j % 6 === 0 ? 2 : 1
    g.beginPath()
    g.moveTo(0, j * pxPerInch)
    g.lineTo(W, j * pxPerInch)
    g.stroke()
  }
}

export function makeMatCanvas(widthIn: number, heightIn: number, pxPerInch: number): HTMLCanvasElement {
  const W = Math.round(widthIn * pxPerInch)
  const H = Math.round(heightIn * pxPerInch)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const rand = rng(40)
  // base plate colour with a soft vignette
  g.fillStyle = '#22262c'
  g.fillRect(0, 0, W, H)
  const grad = g.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, W * 0.62)
  grad.addColorStop(0, 'rgba(70,76,86,0.28)')
  grad.addColorStop(1, 'rgba(0,0,0,0.38)')
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  // plates: 6" squares with slightly different tints
  const plate = 6 * pxPerInch
  for (let y = 0; y < H; y += plate) {
    for (let x = 0; x < W; x += plate) {
      const t = rand()
      g.fillStyle = `rgba(${t < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rand() * 0.05})`
      g.fillRect(x, y, plate, plate)
    }
  }
  // speckle noise
  const specks = Math.round((W * H) / (pxPerInch > 40 ? 90 : 60))
  for (let i = 0; i < specks; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},${rand() * 0.12})`
    g.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1 + rand() * 2)
  }
  // grime and scorch blotches
  for (let i = 0; i < 26; i++) {
    const x = rand() * W
    const y = rand() * H
    const r = (0.8 + rand() * 2.6) * pxPerInch
    const b = g.createRadialGradient(x, y, 0, x, y, r)
    b.addColorStop(0, `rgba(0,0,0,${0.16 + rand() * 0.14})`)
    b.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = b
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // seams and rivets
  g.lineWidth = Math.max(1, pxPerInch * 0.07)
  g.strokeStyle = 'rgba(0,0,0,0.65)'
  for (let x = 0; x <= W; x += plate) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, H)
    g.stroke()
  }
  for (let y = 0; y <= H; y += plate) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(W, y)
    g.stroke()
  }
  g.fillStyle = 'rgba(120,128,140,0.5)'
  for (let y = 0; y < H; y += plate) {
    for (let x = 0; x < W; x += plate) {
      for (const [dx, dy] of [[0.4, 0.4], [5.6, 0.4], [0.4, 5.6], [5.6, 5.6]] as const) {
        g.beginPath()
        g.arc(x + dx * pxPerInch, y + dy * pxPerInch, pxPerInch * 0.09, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  drawOverlay(g, widthIn, heightIn, pxPerInch)
  return c
}

const images = new Map<string, Promise<HTMLImageElement>>()

function loadMatImage(file: string): Promise<HTMLImageElement> {
  let p = images.get(file)
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`mat texture failed: ${file}`))
      img.src = `${import.meta.env.BASE_URL}assets/mats/${file}`
    })
    images.set(file, p)
  }
  return p
}

/** Tile the generated texture over the whole canvas (a transformed pattern, so no hairline gaps), tint it, then redraw
 *  the killzone markings and grid on top. */
function paintTextured(c: HTMLCanvasElement, img: HTMLImageElement, def: MatDef, widthIn: number, heightIn: number, pxPerInch: number): void {
  const g = c.getContext('2d')!
  const W = c.width
  const H = c.height
  const tilePx = W / def.repeat
  const pat = g.createPattern(img, 'repeat')!
  pat.setTransform(new DOMMatrix().scale(tilePx / img.width))
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.fillStyle = pat
  g.fillRect(0, 0, W, H)
  if (def.gain && def.gain > 1) {
    // brighten by adding the texture to itself (works in every browser, unlike ctx.filter)
    g.globalCompositeOperation = 'lighter'
    g.globalAlpha = Math.min(1, def.gain - 1)
    g.fillRect(0, 0, W, H)
    g.globalAlpha = 1
    if (def.gain > 2) {
      g.globalAlpha = def.gain - 2
      g.fillRect(0, 0, W, H)
      g.globalAlpha = 1
    }
  }
  g.globalCompositeOperation = 'multiply'
  g.fillStyle = def.tint
  g.fillRect(0, 0, W, H)
  g.globalCompositeOperation = 'source-over'
  const vig = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,0,0,0.3)')
  g.fillStyle = vig
  g.fillRect(0, 0, W, H)
  drawOverlay(g, widthIn, heightIn, pxPerInch)
}

/** Mat texture: procedural canvas at once, swapped for the chosen generated texture when it has loaded. The mat comes
 *  from the game seed (mats.ts pickMat) unless `?mat=<id>` is in the URL; `window.__ms.mat()` reports its id. */
export function makeMatTexture(widthIn: number, heightIn: number, low: boolean): CanvasTexture {
  const pxPerInch = low ? 30 : 80
  const canvas = makeMatCanvas(widthIn, heightIn, pxPerInch)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = low ? 1 : 8
  tex.needsUpdate = true
  const def = chooseMat(useGame.getState().state?.seed ?? '', typeof location === 'undefined' ? '' : location.search, getMatPref())
  let loaded = false
  const ms = (typeof window !== 'undefined' ? window.__ms : undefined) as unknown as Record<string, unknown> | undefined
  if (ms) {
    ms.mat = () => def.id
    ms.matLoaded = () => loaded
  }
  void loadMatImage(def.file).then(
    (img) => {
      paintTextured(canvas, img, def, widthIn, heightIn, pxPerInch)
      tex.needsUpdate = true
      loaded = true
      repaintBoard()
    },
    () => {
      /* keep the procedural mat */
    },
  )
  return tex
}
