// npm run bench:ai -- --games 40 --seed 1 [--tier normal] [--vs random|easy] [--teams real|fixture] [--layout <id>]
// Mirror matches on a fixed layout: both teams, both seats. Decisive results only. Gate (docs/spec/40-ai section 3):
// normal beats random >= 95%, zero rejections / stalls / fallbacks, activations with no action < 2%.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EngineBundle, GameSetup, Seat } from '@/engine'
import { bundleFromData, realSetup } from '@/engine/bundle'
import { loadBundle } from '../src/data'
import { createAiDecider } from '../src/ai/decider'
import { aiBudgetMs, type Tier } from '../src/ai/tiers'
import { flatMap, terrainMap } from '../tests/fixtures/maps'
import { makeSetup, testBundle } from '../tests/fixtures/team'
import { playMatch, type MatchResult } from './ai-match'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback
}

const OUT = 'tools/out/bench-report.json'
const TEAMS = ['angels-of-death', 'kommandos']

interface BenchRow {
  game: number
  seed: string
  aiSeat: Seat
  aiTeam: string
  winner: Seat | 'draw' | null
  aiWon: boolean | null
  vp: Record<Seat, number>
  decisions: number
  ms: number
  rejections: number
  stalled: boolean
  fallbacks: number
}

const tier = arg('tier', 'normal') as Tier
const vs = arg('vs', 'random') as Tier
const games = Number(arg('games', '40'))
const seed = arg('seed', '1')
const real = arg('teams', 'real') === 'real'
/** `--weights threat=0.7,die=4` for the tested tier, `--vs-weights ...` for the opponent (self-play tuning) */
function weightsArg(name: string): Record<string, number> | undefined {
  const t = arg(name, '')
  if (!t) return undefined
  return Object.fromEntries(t.split(',').map((kv) => [kv.split('=')[0]!.trim(), Number(kv.split('=')[1])]))
}
const myWeights = weightsArg('weights')
const vsWeights = weightsArg('vs-weights')

let bundle: EngineBundle
let setupFor: (g: number, aiSeat: Seat, teamIdx: number) => GameSetup
if (real) {
  bundle = bundleFromData(loadBundle())
  const layouts = Object.keys(bundle.layouts ?? {}).sort()
  const layoutId = arg('layout', layouts[0] ?? '')
  // `--layouts all` rotates the three killzone layouts per game pair
  const all = arg('layouts', '') === 'all'
  setupFor = (_g, aiSeat, ti) => {
    const ai = TEAMS[ti]!
    const other = TEAMS[1 - ti]!
    return realSetup(bundle, { teams: aiSeat === 'A' ? [ai, other] : [other, ai], layoutId: all ? layouts[Math.floor(_g / 4) % layouts.length]! : layoutId })
  }
} else {
  bundle = testBundle
  setupFor = (g) => makeSetup({ map: g % 2 === 0 ? flatMap() : terrainMap(), sizeA: 5, sizeB: 5 })
}

const rows: BenchRow[] = []
const t0 = Date.now()
let aiMs = 0
let aiDecisions = 0
let aiFallbacks = 0
let aiMax = 0
let zero = 0
let acts = 0
let rejections = 0
let oppRejections = 0
let stalls = 0
let wins = 0
let losses = 0
let draws = 0
let unfinished = 0
let hardStops = 0
let vpDiff = 0
let vpGames = 0
const byKind: Record<string, { n: number; ms: number; max: number; fallbacks: number }> = {}
for (let g = 0; g < games; g++) {
  const aiSeat: Seat = g % 2 === 0 ? 'A' : 'B'
  const ti = Math.floor(g / 2) % 2
  const gameSeed = `${seed}-${g}`
  const setup = setupFor(g, aiSeat, ti)
  const other: Seat = aiSeat === 'A' ? 'B' : 'A'
  const ai = createAiDecider(tier, { seed: `${gameSeed}:${aiSeat}`, ...(myWeights ? { weights: myWeights } : {}) })
  const deciders = {
    [aiSeat]: ai,
    [other]: createAiDecider(vs, { seed: `${gameSeed}:${other}`, ...(vsWeights ? { weights: vsWeights } : {}) }),
  } as Record<Seat, ReturnType<typeof createAiDecider>>
  const m: MatchResult = playMatch(setup, bundle, gameSeed, deciders)
  const s = m.seats[aiSeat]
  for (const [k, v] of Object.entries(ai.memory.stats.byKind)) {
    const a = (byKind[k] ??= { n: 0, ms: 0, max: 0, fallbacks: 0 })
    a.n += v.n
    a.ms += v.ms
    a.max = Math.max(a.max, v.max)
    a.fallbacks += v.fallbacks
  }
  hardStops += ai.memory.stats.hardStops
  const aiWon = m.winner === 'draw' || m.winner === null ? null : m.winner === aiSeat
  if (aiWon === true) wins++
  else if (aiWon === false) losses++
  else if (m.winner === 'draw') draws++
  else unfinished++
  if (m.ended) {
    vpDiff += m.vp[aiSeat] - m.vp[other]
    vpGames++
  }
  aiMs += s.ms
  aiDecisions += s.decisions
  aiFallbacks += s.fallbacks
  aiMax = Math.max(aiMax, s.maxMs)
  zero += s.zeroAction
  acts += s.activations
  rejections += s.rejections
  oppRejections += m.seats[other].rejections
  if (m.stalled || !m.ended) stalls++
  const team = real ? TEAMS[ti]! : 'fixture'
  rows.push({
    game: g,
    seed: gameSeed,
    aiSeat,
    aiTeam: team,
    winner: m.winner,
    aiWon,
    vp: m.vp,
    decisions: m.decisions,
    ms: Math.round(s.ms),
    rejections: s.rejections,
    stalled: m.stalled || !m.ended,
    fallbacks: s.fallbacks,
  })
  console.log(
    `game ${String(g).padStart(2)} ${aiSeat}/${team.slice(0, 3)} winner=${m.winner} vp=${m.vp.A}-${m.vp.B} dec=${m.decisions} ai=${Math.round(s.ms)}ms rej=${s.rejections} fb=${s.fallbacks}${m.firstRejection ? ` REJ(${m.firstRejection})` : ''}`,
  )
}
const decisive = wins + losses
const winRate = decisive ? wins / decisive : 0
const report = {
  tier,
  vs,
  games,
  seed,
  teams: real ? 'real' : 'fixture',
  budgetMs: aiBudgetMs(),
  wins,
  losses,
  draws,
  unfinished,
  decisive,
  winRate,
  meanVpDiff: vpGames ? vpDiff / vpGames : 0,
  meanDecisionMs: aiDecisions ? aiMs / aiDecisions : 0,
  maxDecisionMs: aiMax,
  decisions: aiDecisions,
  rejections,
  opponentRejections: oppRejections,
  fallbacks: aiFallbacks,
  hardStops,
  stalls,
  activations: acts,
  zeroActionShare: acts ? zero / acts : 0,
  wallMs: Date.now() - t0,
  byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { n: v.n, meanMs: v.ms / Math.max(1, v.n), maxMs: v.max, fallbacks: v.fallbacks }])),
  rows,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(report, null, 1))
console.log(
  `bench ${tier} vs ${vs}: ${wins}W ${losses}L ${draws}D ${unfinished}U (decisive win rate ${(winRate * 100).toFixed(1)}%, mean VP diff ${report.meanVpDiff.toFixed(2)}), ` +
    `mean ${report.meanDecisionMs.toFixed(1)} ms/decision (max ${aiMax.toFixed(0)}), rejections ${rejections}, fallbacks ${aiFallbacks}, stalls ${stalls}, ` +
    `zero-action activations ${(report.zeroActionShare * 100).toFixed(1)}% of ${acts}, ${(report.wallMs / 1000).toFixed(0)} s`,
)
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].ms - a[1].ms).slice(0, 8)) {
  console.log(`  ${k.padEnd(22)} n=${String(v.n).padStart(5)} mean ${(v.ms / Math.max(1, v.n)).toFixed(1).padStart(6)} ms  max ${v.max.toFixed(0).padStart(4)}  fallbacks ${v.fallbacks}`)
}
const gate = !(tier === 'normal' && vs === 'random') || winRate >= 0.95
// the zero-action audit is a normal-tier gate (easy plays by sampling among its best plans and may idle now and then)
const clean = rejections === 0 && oppRejections === 0 && stalls === 0 && aiFallbacks === 0 && (tier !== 'normal' || report.zeroActionShare < 0.02)
if (!gate || !clean) {
  console.log(`GATE FAILED: ${!gate ? 'win rate below 95%; ' : ''}${!clean ? 'rejections/stalls/fallbacks/zero-action not clean' : ''}`)
  process.exit(1)
}
console.log('GATE OK')
