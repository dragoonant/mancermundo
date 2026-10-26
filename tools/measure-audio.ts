// Decodes public/audio/<prefix>*.mp3 in headless Chromium (Playwright), prints RMS, peak and crest
// factor (peak / RMS) per file, flags gunshots with crest < 6, and writes:
//   public/audio/trims.json        flat map id -> playback gain (loud files land near the target RMS)
//   tools/audio-src/measure.json   id -> { rms, peak, crest, seconds, gain } for docs/audio.md
// Run with:  npx tsx tools/measure-audio.ts [prefix]
// A partial run (with a prefix) merges into the existing JSON files instead of replacing them.
//
// Gain = min(target / rms, 1 / peak): the playback gain that puts the file at the target RMS without
// clipping. Target is 0.16 for effects and narration, 0.10 for music and ambience beds.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const root = join(import.meta.dirname, '..')
const dir = join(root, 'public', 'audio')
const prefix = process.argv[2] ?? ''
const TARGET_RMS = 0.16
const BED_RMS = 0.1
const CREST_MIN_GUN = 6

/** Ids that are firearm shots (the crest check applies to these). */
const GUNSHOTS = new Set([
  'wpn-bolt-rifle', 'wpn-auto-bolt-rifle', 'wpn-stalker-bolt-rifle', 'wpn-heavy-bolt-pistol', 'wpn-bolt-pistol',
  'wpn-plasma-pistol', 'wpn-plasma-pistol-supercharge', 'wpn-heavy-bolter', 'wpn-bolt-sniper-rifle', 'wpn-grenade-launcher',
  'wpn-slugga', 'wpn-dakka-shoota', 'wpn-rokkit-launcha', 'wpn-shokka-pistol', 'wpn-scoped-big-shoota',
])
const isBed = (id: string) => id.startsWith('music-') || id.startsWith('amb-')

const files = (await readdir(dir)).filter((f) => f.startsWith(prefix) && f.endsWith('.mp3')).sort()
const browser = await chromium.launch()
const page = await browser.newPage()

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return fallback }
}
const trimsPath = join(dir, 'trims.json')
const measurePath = join(root, 'tools', 'audio-src', 'measure.json')
const trims = await readJson<Record<string, number>>(trimsPath, {})
type M = { rms: number; peak: number; crest: number; seconds: number; gain: number }
const measures = await readJson<Record<string, M>>(measurePath, {})

const flagged: string[] = []
for (const f of files) {
  const id = f.replace('.mp3', '')
  const b64 = (await readFile(join(dir, f))).toString('base64')
  const r = await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const buf = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(bytes.buffer)
    const ch = buf.getChannelData(0)
    let sum = 0, peak = 0
    for (const v of ch) { sum += v * v; peak = Math.max(peak, Math.abs(v)) }
    const rms = Math.sqrt(sum / ch.length)
    return { rms, peak, crest: peak / rms, dur: buf.duration }
  }, b64)
  const target = isBed(id) ? BED_RMS : TARGET_RMS
  const gain = Math.round(Math.min(target / r.rms, 1 / r.peak) * 100) / 100
  trims[id] = gain
  measures[id] = { rms: +r.rms.toFixed(4), peak: +r.peak.toFixed(3), crest: +r.crest.toFixed(1), seconds: +r.dur.toFixed(2), gain }
  const flag = GUNSHOTS.has(id) && r.crest < CREST_MIN_GUN ? '  <-- LOW CREST (gunshot < 6)' : ''
  if (flag) flagged.push(id)
  console.log(`${id.padEnd(32)} rms ${r.rms.toFixed(3)} peak ${r.peak.toFixed(2)} crest ${r.crest.toFixed(1).padStart(5)} ${r.dur.toFixed(2).padStart(6)}s gain ${gain.toFixed(2)}${flag}`)
}
await browser.close()

const sortKeys = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
await mkdir(join(root, 'tools', 'audio-src'), { recursive: true })
await writeFile(trimsPath, JSON.stringify(sortKeys(trims), null, 2) + '\n')
await writeFile(measurePath, JSON.stringify(sortKeys(measures), null, 2) + '\n')
console.log(`\nwrote trims.json (${Object.keys(trims).length} ids) and measure.json`)
if (flagged.length) console.log(`gunshots below crest ${CREST_MIN_GUN}: ${flagged.join(', ')}`)
