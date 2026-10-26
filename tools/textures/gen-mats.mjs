// Killzone floor textures via the local Flux Studio (FLUX.2 klein, http://localhost:7880) + seam blending.
//   node tools/textures/gen-mats.mjs gen [id ...]     2-3 candidates per mat -> tools/out/mats-raw/<id>-<seed>.png + <id>-sheet.jpg
//   node tools/textures/gen-mats.mjs build [id ...]   seam-blend the picked seed (tools/textures/picks.json) -> public/assets/mats/
// Needs Python with Pillow + numpy (run isolated: python -I). Node built-ins only. Foreground, one GPU job at a time.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RAW = join(ROOT, 'tools', 'out', 'mats-raw')
const OUT = join(ROOT, 'public', 'assets', 'mats')
const PICKS = join(ROOT, 'tools', 'textures', 'picks.json')
const API = process.env.FLUX_URL ?? 'http://localhost:7880'
const SEAM = 0.12 // fraction of the edge blended with its mirror

const STYLE = 'wordless, no objects, even lighting, flat orthographic view looking straight down, sharp detail, game floor texture'

/** id -> { seeds: candidate seeds, prompt, method: 'mirror' (default) | 'cross' (half-shift blend, for stochastic textures), snap: crop edges to bar centres } */
export const MATS = {
  'plasteel-deck': {
    seeds: [1101, 1102, 1103],
    prompt: `Seamless tileable top-down texture of riveted dark steel deck plates: a regular grid of about four by four square gunmetal plates with thin dark seams, a bolt at every plate corner, scuffed edges and faint oil stains, ${STYLE}`,
  },
  'rust-grating': {
    seeds: [1201, 1202, 1203],
    snap: true,
    prompt: `Seamless tileable top-down texture of rusted industrial metal grating: a square mesh of flat orange-brown rusted bars with a few bolts, deep black void visible through the square holes, ${STYLE}`,
  },
  'cracked-concrete': {
    seeds: [1301, 1302, 1303],
    method: 'cross',
    prompt: `Seamless tileable top-down texture of cracked grey concrete paving: large slabs split by thin dark cracks, dust, stains and small rubble flecks scattered across the surface, ${STYLE}`,
  },
  'ash-waste': {
    seeds: [1401, 1402, 1403],
    method: 'cross',
    prompt: `Seamless tileable top-down texture of a wasteland ground covered in grey-brown ash and cinders, with small dark stones and pebbles half buried in the powdery dust, ${STYLE}`,
  },
  'gothic-flagstones': {
    seeds: [1501, 1502, 1503],
    prompt: `Seamless tileable top-down texture of dark worn stone flagstone floor: irregular slabs about four across, chipped and weathered, with two small black iron drainage grilles set between the flagstones, ${STYLE}`,
  },
  'blood-foundry': {
    seeds: [1611, 1612, 1613],
    method: 'cross',
    prompt: `Seamless tileable top-down texture of a dark cast-iron foundry floor of riveted plates, mostly plain dark metal with low-contrast ochre rust stains, a few small dried dark red blood smears and faint black scorch marks spread evenly across the plates, ${STYLE}`,
  },
}

const PY = String.raw`
import sys, json, io
import numpy as np
from PIL import Image

def sheet(out, ins):
    n = len(ins); T = 512
    s = Image.new('RGB', (T * n, T))
    for i, p in enumerate(ins):
        s.paste(Image.open(p).convert('RGB').resize((T, T), Image.LANCZOS), (i * T, 0))
    s.save(out, quality=85)

def blend(a, frac, axis):
    # mirror-blend: near each edge mix the pixel with its mirror across the wrap, weight 0.5 at the edge -> 0 at frac
    a = a.astype(np.float32)
    n = a.shape[axis]
    b = int(n * frac)
    t = np.arange(b, dtype=np.float32) / b
    w = 0.5 * (1 - (t * t * (3 - 2 * t)))
    shape = [1, 1, 1]; shape[axis] = b
    w = w.reshape(shape)
    lo = np.take(a, range(0, b), axis=axis)
    hi_idx = list(range(n - 1, n - 1 - b, -1))          # mirror of x is n-1-x
    hi = np.take(a, hi_idx, axis=axis)
    out = a.copy()
    sl = [slice(None)] * 3; sl[axis] = slice(0, b)
    out[tuple(sl)] = (1 - w) * lo + w * hi
    sl[axis] = slice(n - b, n)
    out[tuple(sl)] = ((1 - w) * hi + w * lo)[tuple([slice(None, None, -1) if i == axis else slice(None) for i in range(3)])]
    return out

def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)

def cross(a, frac):
    # offset blend: four half-shifted copies weighted so each copy's own seam always has weight 0 (seamless on both axes)
    a = a.astype(np.float32)
    h, w, _ = a.shape
    xs = np.arange(w, dtype=np.float32); ys = np.arange(h, dtype=np.float32)
    wx = smooth(np.minimum(xs, w - 1 - xs) / (w * frac))[None, :, None]
    wy = smooth(np.minimum(ys, h - 1 - ys) / (h * frac))[:, None, None]
    sx = np.roll(a, w // 2, axis=1); sy = np.roll(a, h // 2, axis=0); sxy = np.roll(sx, h // 2, axis=0)
    return a * wx * wy + sx * (1 - wx) * wy + sy * wx * (1 - wy) + sxy * (1 - wx) * (1 - wy)

def runs_centres(profile, thr):
    on = profile > thr
    out = []; i = 0; n = len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]: j += 1
            out.append((i + j - 1) // 2); i = j
        else: i += 1
    return out

def snap(img):
    # crop so both edges pass through the middle of a bar: the wrap then continues the bar instead of doubling it
    a = np.asarray(img.convert('L')).astype(np.float32)
    w, h = img.size
    cx = runs_centres(a.mean(axis=0), a.mean() * 0.9)
    cy = runs_centres(a.mean(axis=1), a.mean() * 0.9)
    x0 = next((c for c in cx if c <= w * 0.14), 0); x1 = next((c for c in reversed(cx) if c >= w * 0.86), w - 1)
    y0 = next((c for c in cy if c <= h * 0.14), 0); y1 = next((c for c in reversed(cy) if c >= h * 0.86), h - 1)
    return img.crop((x0, y0, x1, y1)).resize((w, h), Image.LANCZOS)

def build(src, out, thumb, preview, frac, quality, method, dosnap):
    base = Image.open(src).convert('RGB')
    if dosnap == '1': base = snap(base)
    im = np.asarray(base)
    t = cross(im, frac) if method == 'cross' else blend(blend(im, frac, 1), frac, 0)
    img = Image.fromarray(np.clip(t + 0.5, 0, 255).astype(np.uint8))
    q = quality
    while True:
        buf = io.BytesIO(); img.save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
        if buf.tell() < 400 * 1024 or q <= 60: break
        q -= 2
    open(out, 'wb').write(buf.getvalue())
    img.resize((192, 192), Image.LANCZOS).save(thumb, 'JPEG', quality=80, optimize=True)
    w, h = img.size
    p = Image.new('RGB', (w * 2, h * 2))
    for x in (0, 1):
        for y in (0, 1): p.paste(img, (x * w, y * h))
    p.resize((1536, 1536), Image.LANCZOS).save(preview, 'JPEG', quality=85)
    print(json.dumps({'quality': q, 'bytes': buf.tell()}))

cmd = sys.argv[1]
if cmd == 'sheet': sheet(sys.argv[2], sys.argv[3:])
elif cmd == 'build': build(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], float(sys.argv[6]), int(sys.argv[7]), sys.argv[8], sys.argv[9])
`

function py(...args) {
  return execFileSync('python', ['-I', '-c', PY, ...args.map(String)], { encoding: 'utf8' })
}

async function api(path, init) {
  const r = await fetch(API + path, init)
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
  return r
}

async function setFreeAfter(v) {
  await api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ freeAfter: v }) })
}

async function generate(prompt, seed) {
  const { id } = await (await api('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'klein', prompt, aspect: '1:1', megapixels: 1, batch: 1, seed }),
  })).json()
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    const j = await (await api(`/api/jobs/${id}`)).json()
    if (j.status === 'done') return Buffer.from(await (await api(`/files/${id}/${j.images[0]}`)).arrayBuffer())
    if (j.status === 'error' || j.status === 'failed' || j.status === 'cancelled') throw new Error(`job ${id}: ${j.status} ${j.error ?? ''}`)
  }
  throw new Error(`job ${id} timed out`)
}

const [cmd = 'gen', ...rest] = process.argv.slice(2)
const ids = rest.length ? rest : Object.keys(MATS)
mkdirSync(RAW, { recursive: true })
mkdirSync(OUT, { recursive: true })

if (cmd === 'gen') {
  await api('/api/status')
  await setFreeAfter(false)
  try {
    for (const id of ids) {
      const m = MATS[id]
      if (!m) throw new Error(`unknown mat ${id}`)
      const files = []
      for (const seed of m.seeds) {
        const f = join(RAW, `${id}-${seed}.png`)
        if (!existsSync(f)) {
          writeFileSync(f, await generate(m.prompt, seed))
          console.log(`generated ${id} seed ${seed}`)
        }
        files.push(f)
      }
      py('sheet', join(RAW, `${id}-sheet.jpg`), ...files)
    }
  } finally {
    await setFreeAfter(true)
  }
} else if (cmd === 'build') {
  const picks = JSON.parse(readFileSync(PICKS, 'utf8'))
  const report = {}
  for (const id of ids) {
    const seed = picks[id]
    if (!seed) throw new Error(`no pick for ${id} in picks.json`)
    const out = py('build', join(RAW, `${id}-${seed}.png`), join(OUT, `${id}.jpg`), join(OUT, `${id}-thumb.jpg`), join(OUT, `${id}-tile-preview.jpg`), SEAM, 85, MATS[id].method ?? 'mirror', MATS[id].snap ? '1' : '0')
    report[id] = { seed, ...JSON.parse(out) }
    console.log(id, JSON.stringify(report[id]))
  }
} else {
  console.error('usage: gen-mats.mjs gen|build [ids]')
  process.exit(1)
}
