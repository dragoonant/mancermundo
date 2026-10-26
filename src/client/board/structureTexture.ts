// Textures for terrain built from rules parts (Terrain.tsx): weathered ochre Volkus plating for walls and ramparts,
// dark grated steel for decks. Each is one canvas tile that covers 2 inches (repeat 0.5 against inch UVs), built once,
// deterministic (seeded pseudo-random, never Math.random) and cached. Browser only.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

const TILE_PX = 256
/** one texture tile spans this many inches; UVs on the structure meshes are in inches */
export const TILE_IN = 2

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function finish(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  t.repeat.set(1 / TILE_IN, 1 / TILE_IN)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

function canvasOf(): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = TILE_PX
  canvas.height = TILE_PX
  return { canvas, g: canvas.getContext('2d')! }
}

let wall: CanvasTexture | null = null
let deck: CanvasTexture | null = null

/** Ochre/rust plating: four panels per tile with dark recessed frame lines, grime streaks and rivets. */
export function wallTexture(): CanvasTexture {
  if (wall) return wall
  const rand = rng(40_017)
  const { canvas, g } = canvasOf()
  const half = TILE_PX / 2
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x0 = px * half
      const y0 = py * half
      const t = rand()
      const r = Math.round(154 + t * 31)
      const gr = Math.round(106 + t * 32)
      const b = Math.round(51 + t * 23)
      g.fillStyle = `rgb(${r},${gr},${b})`
      g.fillRect(x0, y0, half, half)
      // grime: dark streaks running down from the top edge of the panel
      for (let i = 0; i < 9; i++) {
        const sx = x0 + rand() * half
        const len = 16 + rand() * (half - 20)
        const grad = g.createLinearGradient(0, y0, 0, y0 + len)
        grad.addColorStop(0, `rgba(40,26,14,${0.16 + rand() * 0.16})`)
        grad.addColorStop(1, 'rgba(40,26,14,0)')
        g.fillStyle = grad
        g.fillRect(sx, y0, 2 + rand() * 6, len)
      }
      // rust speckle
      for (let i = 0; i < 70; i++) {
        g.fillStyle = rand() < 0.5 ? 'rgba(92,48,20,0.22)' : 'rgba(205,160,98,0.16)'
        const s = 1 + rand() * 3
        g.fillRect(x0 + rand() * half, y0 + rand() * half, s, s)
      }
      // rivets along the panel edge
      for (let i = 0; i < 4; i++) {
        const o = 14 + (i * (half - 28)) / 3
        for (const [cx, cy] of [[x0 + o, y0 + 11], [x0 + o, y0 + half - 11]] as const) {
          g.fillStyle = 'rgba(30,20,12,0.55)'
          g.beginPath()
          g.arc(cx + 1, cy + 1, 3.2, 0, Math.PI * 2)
          g.fill()
          g.fillStyle = 'rgb(168,128,78)'
          g.beginPath()
          g.arc(cx, cy, 2.8, 0, Math.PI * 2)
          g.fill()
        }
      }
    }
  }
  // recessed frame lines between panels; drawn across the tile edges too so the tiling is seamless
  g.fillStyle = '#2b2420'
  const w = 6
  for (const c of [0, half, TILE_PX]) {
    g.fillRect(c - w / 2, 0, w, TILE_PX)
    g.fillRect(0, c - w / 2, TILE_PX, w)
  }
  g.fillStyle = 'rgba(214,170,110,0.3)'
  for (const c of [0, half, TILE_PX]) {
    g.fillRect(c + w / 2, 0, 1.5, TILE_PX)
    g.fillRect(0, c + w / 2, TILE_PX, 1.5)
  }
  wall = finish(canvas)
  return wall
}

/** Dark grated steel decking: an 8 x 8 grid of slots per tile on a gunmetal base. */
export function deckTexture(): CanvasTexture {
  if (deck) return deck
  const rand = rng(90_211)
  const { canvas, g } = canvasOf()
  g.fillStyle = '#4a4d52'
  g.fillRect(0, 0, TILE_PX, TILE_PX)
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(20,22,26,0.14)' : 'rgba(120,126,136,0.1)'
    const s = 1 + rand() * 3
    g.fillRect(rand() * TILE_PX, rand() * TILE_PX, s, s)
  }
  const cell = TILE_PX / 8
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = '#25272b'
      g.fillRect(i * cell + 5, j * cell + 8, cell - 10, cell - 16)
      g.fillStyle = 'rgba(150,156,166,0.18)'
      g.fillRect(i * cell + 5, j * cell + cell - 8, cell - 10, 1.5)
    }
  }
  deck = finish(canvas)
  return deck
}
