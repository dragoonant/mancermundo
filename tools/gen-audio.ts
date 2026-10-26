// Generates the audio assets in tools/audio-manifest.json into public/audio/<id>.mp3 using the local
// Audio Studio (http://localhost:7890; ACE-Step music, Stable Audio Open SFX, Qwen3-TTS voice design).
// Idempotent: an id whose public/audio/<id>.mp3 already exists is skipped (use --force to redo it).
//
//   npx tsx tools/gen-audio.ts [--only id ...] [--kind sfx|music|voice] [--dry] [--force] [--keep-src]
//
// Pipeline per item: POST /api/jobs -> poll GET /api/jobs/<id> -> download FLAC/WAV -> decode (WAV in
// pure JS; FLAC via ffmpeg on PATH, else headless Chromium decodeAudioData) -> mono 44.1 kHz ->
// trim leading silence -> short fade-out (loops get an equal-power crossfade instead) -> peak
// -1 dBFS -> MP3 128 kbps mono (lamejs). Items with `copyFrom` are copied from the sibling Mallet-42k
// checkout (override with MALLET_AUDIO_DIR) and never touch the studio.
//
// Owned by the audio task (tools/gen-audio.ts, tools/audio-manifest.json, tools/measure-audio.ts,
// tools/audio-src/**, public/audio/**, public/sounds.html, docs/audio.md).

import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Mp3Encoder } from '@breezystack/lamejs'

const STUDIO = process.env.AUDIO_STUDIO_URL ?? 'http://localhost:7890'
const ROOT = join(import.meta.dirname, '..')
const MANIFEST_PATH = join(ROOT, 'tools', 'audio-manifest.json')
const OUT_DIR = join(ROOT, 'public', 'audio')
const SRC_DIR = join(ROOT, 'tools', 'audio-src')
const LOG_PATH = join(SRC_DIR, 'gen-log.json')
const MALLET_DIR = resolve(process.env.MALLET_AUDIO_DIR ?? join(ROOT, '..', 'Mallet-42k', 'public', 'audio'))
const SR = 44100
const JOB_TIMEOUT_MS = 3 * 60 * 1000
const QUEUE_TIMEOUT_MS = 10 * 60 * 1000
const PEAK_TARGET = Math.pow(10, -1 / 20) // -1 dBFS

interface Item {
  id: string
  kind: 'sfx' | 'music' | 'voice'
  group: string
  copyFrom?: string
  prompt?: string
  negative?: string
  seconds?: number
  duration?: number
  text?: string
  instruct?: string
  language?: string
  bpm?: number
  key?: string
  timesig?: string
  steps?: number
  guidance?: number
  seed?: number
  loop?: boolean
  /** Optional manual trim in ms from the decoded start/end, applied after silence trimming. */
  trim?: { startMs?: number; endMs?: number }
}
interface Manifest {
  voice?: { model?: string; language?: string }
  items: Item[]
}
interface Job {
  id: string
  status: string
  audios?: string[]
  error?: string
  log?: string[]
  phase?: string
}
interface LogEntry { seconds: number; wallSeconds: number; job: string; seed?: number; at: string }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ---------- args ----------
const argv = process.argv.slice(2)
const only: string[] = []
let kind: string | undefined
let dry = false
let force = false
let keepSrc = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dry') dry = true
  else if (a === '--force') force = true
  else if (a === '--keep-src') keepSrc = true
  else if (a === '--kind') kind = argv[++i]
  else if (a === '--only') while (argv[i + 1] && !argv[i + 1].startsWith('--')) only.push(argv[++i])
  else { console.error(`unknown argument ${a}`); process.exit(2) }
}

async function exists(p: string): Promise<boolean> {
  try { const s = await stat(p); return s.isFile() && s.size > 0 } catch { return false }
}

// ---------- studio API ----------
async function studioStatus(): Promise<{ comfy?: string; running?: unknown; queued?: number } | null> {
  try {
    const r = await fetch(`${STUDIO}/api/status`)
    return r.ok ? ((await r.json()) as { comfy?: string }) : null
  } catch { return null }
}

let studioChecked = false
async function ensureStudio(): Promise<void> {
  if (studioChecked) return
  let s = await studioStatus()
  if (!s) throw new Error(`Audio Studio is not reachable at ${STUDIO}. Start it and rerun.`)
  const deadline = Date.now() + 2 * 60 * 1000
  while (s && s.comfy === 'down') {
    if (Date.now() > deadline) throw new Error('ComfyUI is down and did not come up within 2 minutes. Start the studios and rerun.')
    console.log('[gen-audio] ComfyUI is down, waiting...')
    await sleep(10_000)
    s = await studioStatus()
  }
  studioChecked = true
}

function jobParams(item: Item, manifest: Manifest): Record<string, unknown> {
  if (item.kind === 'sfx') {
    return { mode: 'sfx', prompt: item.prompt, negative: item.negative ?? '', seconds: item.seconds ?? 3, steps: item.steps ?? 50, guidance: item.guidance ?? 5, batch: 1, ...(item.seed ? { seed: item.seed } : {}) }
  }
  if (item.kind === 'music') {
    return { mode: 'music', prompt: item.prompt, lyrics: '', duration: item.duration ?? 60, steps: item.steps ?? 8, bpm: item.bpm ?? 100, key: item.key ?? 'D minor', timesig: item.timesig ?? '4', language: 'en', batch: 1, ...(item.seed ? { seed: item.seed } : {}) }
  }
  return { mode: 'voice', model: manifest.voice?.model ?? 'qwen-design', text: item.text, language: item.language ?? manifest.voice?.language ?? 'English', instruct: item.instruct ?? '', ...(item.seed ? { seed: item.seed } : {}) }
}

async function postJob(params: Record<string, unknown>): Promise<Job> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const r = await fetch(`${STUDIO}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })
    if (r.status === 409 || r.status === 429 || r.status === 503) {
      console.log(`[gen-audio] studio busy (${r.status}), retrying in 5 s`)
      await sleep(5000)
      continue
    }
    if (!r.ok) throw new Error(`POST /api/jobs failed: ${r.status} ${await r.text()}`)
    return (await r.json()) as Job
  }
  throw new Error('studio stayed busy (409) for too long')
}

class RestartError extends Error {}

async function waitForJob(id: string): Promise<Job> {
  const queuedSince = Date.now()
  let runningSince = 0
  for (;;) {
    await sleep(1500)
    const r = await fetch(`${STUDIO}/api/jobs/${id}`)
    if (!r.ok) throw new Error(`GET /api/jobs/${id} failed: ${r.status}`)
    const j = (await r.json()) as Job
    if (j.status === 'done') return j
    if (j.status === 'failed' || j.status === 'cancelled') {
      const why = j.error ?? j.log?.slice(-2).join(' | ') ?? j.status
      if (/restart/i.test(why)) throw new RestartError(why)
      throw new Error(`job ${id} ${j.status}: ${why}`)
    }
    if (j.status === 'running') {
      if (!runningSince) runningSince = Date.now()
      if (Date.now() - runningSince > JOB_TIMEOUT_MS) {
        await fetch(`${STUDIO}/api/jobs/${id}/cancel`, { method: 'POST' }).catch(() => undefined)
        throw new Error(`job ${id} exceeded ${JOB_TIMEOUT_MS / 1000} s, cancelled`)
      }
    } else if (Date.now() - queuedSince > QUEUE_TIMEOUT_MS) {
      await fetch(`${STUDIO}/api/jobs/${id}/cancel`, { method: 'POST' }).catch(() => undefined)
      throw new Error(`job ${id} stayed queued for ${QUEUE_TIMEOUT_MS / 1000} s, cancelled`)
    }
  }
}

async function runJob(item: Item, manifest: Manifest): Promise<{ file: Buffer; name: string; job: Job; seed?: number }> {
  const params = jobParams(item, manifest)
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureStudio()
      const posted = await postJob(params)
      const done = await waitForJob(posted.id)
      const name = done.audios?.[0] ?? (item.kind === 'voice' ? 'voice.wav' : 'audio_0.flac')
      const r = await fetch(`${STUDIO}/files/${done.id}/${name}`)
      if (!r.ok) throw new Error(`download ${name} failed: ${r.status}`)
      const seed = (done as unknown as { params?: { seed?: number } }).params?.seed
      return { file: Buffer.from(await r.arrayBuffer()), name, job: done, seed }
    } catch (err) {
      if (attempt >= 2) throw err
      console.log(`[gen-audio] ${item.id}: ${(err as Error).message}; retrying once${err instanceof RestartError ? ' (server restarted)' : ''}`)
      studioChecked = false
      await sleep(err instanceof RestartError ? 15_000 : 3000)
    }
  }
}

// ---------- decoding ----------
function decodeWav(buf: Buffer): { pcm: Float32Array; rate: number } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file')
  let pos = 12
  let fmt: { tag: number; ch: number; rate: number; bits: number } | undefined
  let data: Buffer | undefined
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    let size = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (body + size > buf.length) size = buf.length - body // streamed WAVs may carry a bogus size
    if (id === 'fmt ') {
      let tag = buf.readUInt16LE(body)
      if (tag === 0xfffe && size >= 26) tag = buf.readUInt16LE(body + 24)
      fmt = { tag, ch: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) }
    } else if (id === 'data') { data = buf.subarray(body, body + size); break }
    pos = body + size + (size & 1)
  }
  if (!fmt || !data) throw new Error('WAV missing fmt or data chunk')
  const bytes = fmt.bits / 8
  const frames = Math.floor(data.length / (bytes * fmt.ch))
  const pcm = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * bytes
      let v: number
      if (fmt.tag === 3) v = fmt.bits === 64 ? data.readDoubleLE(o) : data.readFloatLE(o)
      else if (fmt.bits === 16) v = data.readInt16LE(o) / 32768
      else if (fmt.bits === 24) v = data.readIntLE(o, 3) / 8388608
      else if (fmt.bits === 32) v = data.readInt32LE(o) / 2147483648
      else if (fmt.bits === 8) v = (data.readUInt8(o) - 128) / 128
      else throw new Error(`unsupported WAV bit depth ${fmt.bits}`)
      sum += v
    }
    pcm[i] = sum / fmt.ch
  }
  return { pcm, rate: fmt.rate }
}

function resample(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return pcm
  const n = Math.floor((pcm.length * to) / from)
  const out = new Float32Array(n)
  const ratio = from / to
  for (let i = 0; i < n; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const f = x - i0
    out[i] = pcm[i0] * (1 - f) + (pcm[Math.min(i0 + 1, pcm.length - 1)] ?? 0) * f
  }
  return out
}

let ffmpegOk: boolean | undefined
async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegOk !== undefined) return ffmpegOk
  ffmpegOk = await new Promise<boolean>((res) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' })
    p.on('error', () => res(false))
    p.on('exit', (c) => res(c === 0))
  })
  return ffmpegOk
}

function decodeWithFfmpeg(buf: Buffer): Promise<Float32Array> {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(SR), 'pipe:1'])
    const chunks: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.on('error', rej)
    p.on('exit', (code) => {
      if (code !== 0) return rej(new Error(`ffmpeg exited ${code}`))
      const all = Buffer.concat(chunks)
      res(new Float32Array(all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength)))
    })
    p.stdin.end(buf)
  })
}

// Headless Chromium (Playwright) decodes FLAC/MP3/WAV with decodeAudioData and resamples to 44.1 kHz.
type Browser = { newPage(): Promise<{ evaluate: <T, A>(fn: (a: A) => Promise<T> | T, a: A) => Promise<T> }>; close(): Promise<void> }
let browser: Browser | undefined
let page: Awaited<ReturnType<Browser['newPage']>> | undefined
async function decodeWithChromium(buf: Buffer): Promise<Float32Array> {
  if (!browser) {
    const { chromium } = await import('@playwright/test')
    browser = (await chromium.launch()) as unknown as Browser
    page = await browser.newPage()
  }
  const b64 = await page!.evaluate(async (data: string) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const ab = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(bytes.buffer)
    const mono = new Float32Array(ab.length)
    for (let c = 0; c < ab.numberOfChannels; c++) {
      const ch = ab.getChannelData(c)
      for (let i = 0; i < ab.length; i++) mono[i] += ch[i] / ab.numberOfChannels
    }
    const u8 = new Uint8Array(mono.buffer)
    let s = ''
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
    return btoa(s)
  }, buf.toString('base64'))
  const raw = Buffer.from(b64, 'base64')
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
}

async function decode(buf: Buffer, name: string): Promise<Float32Array> {
  if (buf.toString('ascii', 0, 4) === 'RIFF') {
    const { pcm, rate } = decodeWav(buf)
    return resample(pcm, rate, SR)
  }
  if (await hasFfmpeg()) return decodeWithFfmpeg(buf)
  try { return await decodeWithChromium(buf) } catch (err) {
    await mkdir(SRC_DIR, { recursive: true })
    const keep = join(SRC_DIR, name)
    await writeFile(keep, buf)
    throw new Error(`no ffmpeg and Chromium could not decode ${name}: ${(err as Error).message}; raw file saved to ${keep}`)
  }
}

// ---------- processing ----------
function peakOf(p: Float32Array): number {
  let m = 0
  for (const v of p) m = Math.max(m, Math.abs(v))
  return m
}

/** Drops leading silence: first sample above -50 dBFS of the file peak, kept 5 ms early. */
function trimLeading(p: Float32Array): Float32Array {
  const thr = Math.max(0.0015, peakOf(p) * 0.003)
  let i = 0
  while (i < p.length && Math.abs(p[i]) < thr) i++
  return p.subarray(Math.max(0, i - Math.round(SR * 0.005)))
}

function trimTrailing(p: Float32Array): Float32Array {
  const thr = Math.max(0.0015, peakOf(p) * 0.003)
  let i = p.length - 1
  while (i > 0 && Math.abs(p[i]) < thr) i--
  return p.subarray(0, Math.min(p.length, i + 1 + Math.round(SR * 0.05)))
}

function fadeOut(p: Float32Array, ms: number): Float32Array {
  const out = Float32Array.from(p)
  const n = Math.min(out.length, Math.round((SR * ms) / 1000))
  for (let i = 0; i < n; i++) out[out.length - 1 - i] *= i / n
  return out
}

/** Equal-power crossfade of the tail into the head so the file loops seamlessly. */
function makeLoop(p: Float32Array, seconds = 1.5): Float32Array {
  const xf = Math.min(Math.round(SR * seconds), Math.floor(p.length / 3))
  const n = p.length - xf
  const out = new Float32Array(n)
  out.set(p.subarray(0, n))
  for (let i = 0; i < xf; i++) {
    const t = i / xf
    out[i] = p[i] * Math.sin((t * Math.PI) / 2) + p[n + i] * Math.cos((t * Math.PI) / 2)
  }
  return out
}

function processAudio(pcm: Float32Array, item: Item): Float32Array {
  let p = trimLeading(pcm)
  if (item.kind !== 'music' || (item.duration ?? 60) <= 20) p = trimTrailing(p)
  if (item.trim?.startMs) p = p.subarray(Math.round((SR * item.trim.startMs) / 1000))
  if (item.trim?.endMs) p = p.subarray(0, Math.max(1, p.length - Math.round((SR * item.trim.endMs) / 1000)))
  p = item.loop ? makeLoop(p) : fadeOut(p, item.kind === 'music' ? 120 : 15)
  const peak = peakOf(p)
  if (peak > 0) {
    const g = PEAK_TARGET / peak
    p = p.map((v) => v * g)
  }
  return p
}

function encodeMp3(pcm: Float32Array): Buffer {
  const enc = new Mp3Encoder(1, SR, 128)
  const i16 = Int16Array.from(pcm, (v) => Math.max(-32767, Math.min(32767, Math.round(v * 32767))))
  const parts: Uint8Array[] = []
  for (let i = 0; i < i16.length; i += 1152) parts.push(enc.encodeBuffer(i16.subarray(i, i + 1152)))
  parts.push(enc.flush())
  return Buffer.concat(parts.map((x) => Buffer.from(x)))
}

// ---------- main ----------
async function readLog(): Promise<Record<string, LogEntry>> {
  try { return JSON.parse(await readFile(LOG_PATH, 'utf8')) as Record<string, LogEntry> } catch { return {} }
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest
  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(SRC_DIR, { recursive: true })
  const log = await readLog()
  let items = manifest.items
  if (only.length) {
    const missing = only.filter((id) => !items.some((i) => i.id === id))
    if (missing.length) throw new Error(`unknown ids: ${missing.join(', ')}`)
    items = items.filter((i) => only.includes(i.id))
  }
  if (kind) items = items.filter((i) => i.kind === kind)

  let copied = 0, generated = 0, skipped = 0, failed = 0, audioSeconds = 0
  const failures: string[] = []

  // Phase 1: copies (no studio needed).
  for (const item of items.filter((i) => i.copyFrom)) {
    const out = join(OUT_DIR, `${item.id}.mp3`)
    if (!force && (await exists(out))) { skipped++; continue }
    const from = join(MALLET_DIR, item.copyFrom!)
    if (dry) { console.log(`[dry] copy ${item.copyFrom} -> ${item.id}.mp3`); continue }
    if (!(await exists(from))) { console.error(`[gen-audio] MISSING copy source ${from} for ${item.id}`); failed++; failures.push(item.id); continue }
    await copyFile(from, out)
    copied++
    console.log(`[gen-audio] copied ${item.copyFrom} -> ${item.id}.mp3`)
  }

  // Phase 2: generation, strictly one job at a time.
  for (const item of items.filter((i) => !i.copyFrom)) {
    const out = join(OUT_DIR, `${item.id}.mp3`)
    if (!force && (await exists(out))) { skipped++; continue }
    if (dry) { console.log(`[dry] generate ${item.id} (${item.kind}) ${JSON.stringify(jobParams(item, manifest))}`); continue }
    const t0 = Date.now()
    try {
      const { file, name, job, seed } = await runJob(item, manifest)
      if (keepSrc) await writeFile(join(SRC_DIR, `${item.id}-${name}`), file)
      const decoded = await decode(file, name)
      const pcm = processAudio(decoded, item)
      await writeFile(out, encodeMp3(pcm))
      const seconds = pcm.length / SR
      const wall = (Date.now() - t0) / 1000
      audioSeconds += seconds
      generated++
      log[item.id] = { seconds: Math.round(seconds * 100) / 100, wallSeconds: Math.round(wall * 10) / 10, job: job.id, seed, at: new Date().toISOString() }
      await writeFile(LOG_PATH, JSON.stringify(log, null, 2) + '\n')
      console.log(`[gen-audio] ${item.id} (${item.kind}) ${seconds.toFixed(2)} s of audio in ${wall.toFixed(0)} s`)
    } catch (err) {
      failed++
      failures.push(item.id)
      console.error(`[gen-audio] FAILED ${item.id}: ${(err as Error).message}`)
    }
  }

  await browser?.close()
  console.log(`[gen-audio] done: ${generated} generated (${audioSeconds.toFixed(1)} s audio), ${copied} copied, ${skipped} already present, ${failed} failed${failures.length ? ` [${failures.join(', ')}]` : ''}`)
  if (failed) process.exitCode = 1
}

main().catch((err) => {
  console.error('[gen-audio] fatal:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
