// Save game (one game in progress per browser, kept in localStorage on this device only). The engine's SaveFile is
// a replay (setup + seed + action log + final hash), so it is tiny and exact; the client wraps it in one versioned
// envelope with the bits only the client knows (seats, bot level, the team builds, a summary for the Continue card).
// Nothing here throws: storage errors (quota, private mode, blocked) are swallowed and a bad save reads as "discarded".
import type { Seat, SaveFile } from '@/engine'
import type { SeatMode } from '../params'
import type { BotTier } from '../bot/botTier'
import { isTier } from '../bot/botTier'
import { dataBundle, type SeatBuild } from '../game/adapter'

export const SAVE_KEY = 'ms.save'
export const SAVE_KIND = 'mancermundo-save'
export const SAVE_ENVELOPE_VERSION = 1

export interface SaveMeta {
  seats: Record<Seat, SeatMode>
  botTier: BotTier
  seed: string
  missionId: string
  layoutId: string
  builds: Record<Seat, SeatBuild>
  /** summary for the Continue card, refreshed on every save */
  teams: Record<Seat, string>
  turningPoint: number
  phase: string
}

export interface SaveEnvelope {
  kind: typeof SAVE_KIND
  v: typeof SAVE_ENVELOPE_VERSION
  savedAt: number
  meta: SaveMeta
  file: SaveFile
}

export type DiscardReason = 'unreadable' | 'outdated'

export const DISCARD_MESSAGE: Record<DiscardReason, string> = {
  unreadable: 'Your saved game could not be read, so it was cleared. Start a new one below.',
  outdated: "Your saved game is from an older version and can't be continued. Start a new one below.",
}

export interface SaveSummary {
  teamA: string
  teamB: string
  /** 'Hot-seat' or 'vs bot' */
  mode: string
  progress: string
  savedAt: number
}

// ---------------------------------------------------------------- storage (never throws)

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function writeSave(env: SaveEnvelope): boolean {
  try {
    const s = storage()
    if (!s) return false
    s.setItem(SAVE_KEY, JSON.stringify(env))
    return true
  } catch {
    return false
  }
}

export function clearSave(): void {
  try {
    storage()?.removeItem(SAVE_KEY)
  } catch {
    // ignore
  }
}

export function hasSave(): boolean {
  try {
    return storage()?.getItem(SAVE_KEY) != null
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- envelope

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Shape and data check only (cheap): a save whose teams or mission no longer exist cannot be restored. Returns null when fine. */
export function envelopeProblem(e: unknown): DiscardReason | null {
  if (!isObj(e) || e.kind !== SAVE_KIND) return 'unreadable'
  if (e.v !== SAVE_ENVELOPE_VERSION) return 'outdated'
  const m = e.meta
  const f = e.file
  if (typeof e.savedAt !== 'number' || !isObj(m) || !isObj(f)) return 'unreadable'
  if (f.version !== 1 || typeof f.seed !== 'string' || typeof f.finalHash !== 'string' || !Array.isArray(f.actions) || !isObj(f.setup)) return 'unreadable'
  const seats = m.seats
  const teams = m.teams
  const builds = m.builds
  if (!isObj(seats) || !isObj(teams) || !isObj(builds) || !isObj(builds.A) || !isObj(builds.B)) return 'unreadable'
  if (!['human', 'bot'].includes(String(seats.A)) || !['human', 'bot'].includes(String(seats.B))) return 'unreadable'
  if (!isTier(m.botTier) || typeof m.missionId !== 'string' || typeof m.layoutId !== 'string' || typeof m.seed !== 'string') return 'unreadable'
  if (typeof m.turningPoint !== 'number' || typeof m.phase !== 'string') return 'unreadable'
  const b = dataBundle()
  if (!b.missions[m.missionId] || !b.layouts[m.layoutId]) return 'outdated'
  for (const s of ['A', 'B']) {
    const id = teams[s]
    if (typeof id !== 'string' || !b.teams[id] || (builds[s] as { teamId?: unknown }).teamId !== id) return 'outdated'
  }
  return null
}

export type ReadResult = { status: 'none' } | { status: 'ok'; env: SaveEnvelope } | { status: 'bad'; reason: DiscardReason }

/** Read and check the stored save. Anything wrong is reported as `bad` (the caller clears it and shows the notice). */
export function readSave(): ReadResult {
  let raw: string | null
  try {
    raw = storage()?.getItem(SAVE_KEY) ?? null
  } catch {
    return { status: 'none' }
  }
  if (raw === null) return { status: 'none' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'bad', reason: 'unreadable' }
  }
  const problem = envelopeProblem(parsed)
  return problem ? { status: 'bad', reason: problem } : { status: 'ok', env: parsed as SaveEnvelope }
}

// ---------------------------------------------------------------- summary for the Continue card

const PHASE_WORD: Record<string, string> = { strategy: 'Strategy phase', firefight: 'Firefight phase' }

export function progressText(turningPoint: number, phase: string): string {
  if (phase === 'setup' || turningPoint < 1) return 'Setting up the battle'
  return `Turning point ${turningPoint}, ${PHASE_WORD[phase] ?? phase}`
}

export function summarize(env: SaveEnvelope): SaveSummary {
  const teams = dataBundle().teams
  const { meta } = env
  const bots = (['A', 'B'] as const).filter((s) => meta.seats[s] === 'bot').length
  return {
    teamA: teams[meta.teams.A]?.name ?? meta.teams.A,
    teamB: teams[meta.teams.B]?.name ?? meta.teams.B,
    mode: bots === 0 ? 'Hot-seat' : 'vs bot',
    progress: progressText(meta.turningPoint, meta.phase),
    savedAt: env.savedAt,
  }
}

/** "just now", "5 minutes ago", "yesterday", "3 days ago". */
export function relativeTime(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return m <= 1 ? 'a minute ago' : `${m} minutes ago`
  const h = Math.round(m / 60)
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 60) return `${d} days ago`
  return 'a long while ago'
}
