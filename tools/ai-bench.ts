// npm run bench:ai -- --games 40 --seed 1 [--start 0] [--tier normal] [--vs random|easy|normal] [--scenario all|scn.tunnel-skirmish|scn.smash-and-grab|scn.forgotten-riches]
//                     [--rounds 12] [--weights threat=0.7,...] [--vs-weights ...]
// The tested tier plays Goliath and Escher in turn, in both seats (game g: house and seat cycle every four games), against
// the opponent tier playing the other house; scenarios rotate with `--scenario all`. A win is the engine's result (winner by
// scenario points). A battle that hits the round cap with equal points is decided by the scenario's own projection
// (caskets secured or opened) and then by the casualty-weighted margin (Leader 3, Champion 2, other 1 per fighter Out of
// Action or fled), so a cap does not hide who was winning; the report counts those separately. Gate (docs/spec/40-ai.md section 3): normal beats random >= 95%, zero rejections / stalls /
// fallbacks / unhandled decision kinds, activations with no action < 2%, decision p50 < 50 ms.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EngineBundle, Seat } from '@/engine'
import { boardsFor, realBundle } from '../tests/fixtures/real'
import { createAiDecider, type AiDecider } from '../src/ai/decider'
import { aiBudgetMs, type Tier } from '../src/ai/tiers'
import { playMatch, type MatchResult } from './ai-match'
import { pairingFor, SCENARIOS } from './ai-pairing'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback
}

const OUT = 'tools/out/bench-report.json'

function weightsArg(name: string): Record<string, number> | undefined {
  const t = arg(name, '')
  if (!t) return undefined
  return Object.fromEntries(t.split(',').map((kv) => [kv.split('=')[0]!.trim(), Number(kv.split('=')[1])]))
}

const tier = arg('tier', 'normal') as Tier
const vs = arg('vs', 'random') as Tier
const games = Number(arg('games', '40'))
const start = Number(arg('start', '0'))
const seed = arg('seed', '1')
const rounds = Number(arg('rounds', '12'))
const scenarioArg = arg('scenario', 'all')
const myWeights = weightsArg('weights')
const vsWeights = weightsArg('vs-weights')
const verbose = process.argv.includes('--verbose')

const bundle: EngineBundle = realBundle()
const scenarios = scenarioArg === 'all' ? SCENARIOS.filter((s) => boardsFor(bundle, s).length > 0) : [scenarioArg]
const setupFor = (g: number) => pairingFor(bundle, g, scenarios, rounds)

interface BenchRow {
  game: number
  seed: string
  scenario: string
  board: string
  aiSeat: Seat
  aiHouse: string
  winner: Seat | 'draw' | null
  result: 'win' | 'loss' | 'draw' | 'unfinished'
  byCap: boolean
  points: Record<Seat, number>
  casualtyPoints: Record<Seat, number>
  rounds: number
  decisions: number
  ms: number
  rejections: number
  stalled: boolean
  fallbacks: number
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
let capDecided = 0
let marginSum = 0
let marginGames = 0
let errors = 0
const samples: number[] = []
const byKind: Record<string, { n: number; ms: number; max: number; fallbacks: number }> = {}
const unhandled: Record<string, number> = {}
const actionMix: Record<string, number> = {}
const zeroBy: Record<string, number> = {}
const kindsSeen: Record<string, number> = {}
/** objective play: Smash & Grab games where the AI raided and the caskets it cracked; Forgotten Riches games and the loot it secured against the opponent's */
const objective = { raidGames: 0, raidOpened: 0, raidWon: 0, lootGames: 0, lootSecured: 0, lootAgainst: 0, lootWon: 0 }
const byGroup: Record<string, { games: number; wins: number; losses: number; draws: number }> = {}

for (let g = start; g < start + games; g++) {
  const { setup, aiSeat, aiHouse, scenario } = setupFor(g)
  const other: Seat = aiSeat === 'A' ? 'B' : 'A'
  const gameSeed = `${seed}-${g}`
  const ai = createAiDecider(tier, { seed: `${gameSeed}:${aiSeat}`, ...(myWeights ? { weights: myWeights } : {}) })
  const deciders = { [aiSeat]: ai, [other]: createAiDecider(vs, { seed: `${gameSeed}:${other}`, ...(vsWeights ? { weights: vsWeights } : {}) }) } as Record<Seat, AiDecider>
  const m: MatchResult = playMatch(setup, bundle, gameSeed, deciders)
  const s = m.seats[aiSeat]
  for (const [k, v] of Object.entries(ai.memory.stats.byKind)) {
    const a = (byKind[k] ??= { n: 0, ms: 0, max: 0, fallbacks: 0 })
    a.n += v.n
    a.ms += v.ms
    a.max = Math.max(a.max, v.max)
    a.fallbacks += v.fallbacks
  }
  for (const [k, v] of Object.entries(ai.memory.stats.unhandled)) unhandled[k] = (unhandled[k] ?? 0) + v
  for (const [k, v] of Object.entries(s.actions)) actionMix[k] = (actionMix[k] ?? 0) + v
  for (const [k, v] of Object.entries(m.kinds)) kindsSeen[k] = (kindsSeen[k] ?? 0) + v
  if (scenario === 'scn.smash-and-grab' && m.roles[aiSeat] === 'attacker') {
    objective.raidGames++
    objective.raidOpened += m.loot.opened
    if (m.winner === aiSeat) objective.raidWon++
  }
  if (scenario === 'scn.forgotten-riches') {
    objective.lootGames++
    objective.lootSecured += m.loot.secured[aiSeat]
    objective.lootAgainst += m.loot.secured[other]
    if (m.winner === aiSeat) objective.lootWon++
  }
  for (const [k, v] of Object.entries(s.zeroBy)) zeroBy[k] = (zeroBy[k] ?? 0) + v
  samples.push(...ai.memory.stats.samples)
  hardStops += ai.memory.stats.hardStops
  errors += ai.memory.stats.errors
  // the engine's winner; a tie at the round cap falls to the casualty margin
  let winner = m.winner
  let byCap = false
  if (m.ended && winner === 'draw' && m.reason === 'roundLimit') {
    // the scenario's own projection first (caskets secured or opened), then the casualty margin
    const d = m.casualtyPoints[aiSeat] - m.casualtyPoints[other]
    const lead = m.leading && m.leading !== 'draw' ? m.leading : d !== 0 ? (d > 0 ? aiSeat : other) : null
    if (lead) {
      winner = lead
      byCap = true
      capDecided++
    }
  }
  const result: BenchRow['result'] = !m.ended ? 'unfinished' : winner === 'draw' || winner === null ? 'draw' : winner === aiSeat ? 'win' : 'loss'
  if (result === 'win') wins++
  else if (result === 'loss') losses++
  else if (result === 'draw') draws++
  else unfinished++
  if (m.ended) {
    marginSum += m.points[aiSeat] - m.points[other] + (byCap || m.reason === 'roundLimit' ? m.casualtyPoints[aiSeat] - m.casualtyPoints[other] : 0)
    marginGames++
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
  const gk = `${scenario}/${aiHouse}`
  const grp = (byGroup[gk] ??= { games: 0, wins: 0, losses: 0, draws: 0 })
  grp.games++
  if (result === 'win') grp.wins++
  else if (result === 'loss') grp.losses++
  else grp.draws++
  rows.push({
    game: g,
    seed: gameSeed,
    scenario,
    board: setup.boardId,
    aiSeat,
    aiHouse,
    winner,
    result,
    byCap,
    points: m.points,
    casualtyPoints: m.casualtyPoints,
    rounds: m.rounds,
    decisions: m.decisions,
    ms: Math.round(s.ms),
    rejections: s.rejections,
    stalled: m.stalled || !m.ended,
    fallbacks: s.fallbacks,
  })
  console.log(
    `game ${String(g).padStart(2)} ${aiSeat}/${aiHouse.slice(0, 3)} ${scenario.replace('scn.', '').slice(0, 8)} ${result.padEnd(4)}${byCap ? '*' : ' '} r${m.rounds} pts=${m.points.A}-${m.points.B} cas=${m.casualtyPoints.A}-${m.casualtyPoints.B}${scenario === 'scn.tunnel-skirmish' ? '' : ` loot=${m.loot.secured.A}-${m.loot.secured.B}/${m.loot.opened}`} dec=${m.decisions} ai=${Math.round(s.ms)}ms rej=${s.rejections} fb=${s.fallbacks}${m.firstRejection ? ` REJ(${m.firstRejection})` : ''}`,
  )
  if (verbose) console.log('   actions', JSON.stringify(s.actions))
}
samples.sort((a, b) => a - b)
const pct = (p: number) => (samples.length ? samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]! : 0)
const decisive = wins + losses
const winRate = decisive ? wins / decisive : 0
const report = {
  tier,
  vs,
  games,
  seed,
  rounds,
  scenarios,
  budgetMs: aiBudgetMs(),
  wins,
  losses,
  draws,
  unfinished,
  decisive,
  winRate,
  decidedByCasualtyMargin: capDecided,
  meanMargin: marginGames ? marginSum / marginGames : 0,
  meanDecisionMs: aiDecisions ? aiMs / aiDecisions : 0,
  p50DecisionMs: pct(0.5),
  p95DecisionMs: pct(0.95),
  maxDecisionMs: aiMax,
  decisions: aiDecisions,
  rejections,
  opponentRejections: oppRejections,
  fallbacks: aiFallbacks,
  unhandledKinds: unhandled,
  policyErrors: errors,
  hardStops,
  stalls,
  activations: acts,
  zeroActionActivations: zero,
  zeroActionShare: acts ? zero / acts : 0,
  actionMix,
  zeroActionByStatus: zeroBy,
  decisionKindsSeen: kindsSeen,
  objectivePlay: objective,
  wallMs: Date.now() - t0,
  byGroup,
  byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { n: v.n, meanMs: v.ms / Math.max(1, v.n), maxMs: v.max, fallbacks: v.fallbacks }])),
  rows,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(report, null, 1))
console.log(
  `bench ${tier} vs ${vs}: ${wins}W ${losses}L ${draws}D ${unfinished}U (decisive win rate ${(winRate * 100).toFixed(1)}%, ${capDecided} decided by casualty margin at the round cap, mean margin ${report.meanMargin.toFixed(2)}), ` +
    `decision p50 ${report.p50DecisionMs.toFixed(1)} ms / p95 ${report.p95DecisionMs.toFixed(1)} / mean ${report.meanDecisionMs.toFixed(1)} (max ${aiMax.toFixed(0)}), rejections ${rejections}, fallbacks ${aiFallbacks}, ` +
    `unhandled ${JSON.stringify(unhandled)}, stalls ${stalls}, zero-action activations ${(report.zeroActionShare * 100).toFixed(1)}% of ${acts}, ${(report.wallMs / 1000).toFixed(0)} s`,
)
for (const [k, v] of Object.entries(byGroup).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  console.log(`  ${k.padEnd(34)} ${v.wins}W ${v.losses}L ${v.draws}D of ${v.games}`)
}
console.log('  decision kinds seen (both seats): ' + Object.entries(kindsSeen).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '))
console.log(`  objective play: Smash & Grab raids ${objective.raidGames} (cracked ${objective.raidOpened} caskets, won ${objective.raidWon}); Forgotten Riches ${objective.lootGames} (secured ${objective.lootSecured} vs ${objective.lootAgainst}, won ${objective.lootWon})`)
console.log('  zero-action by status: ' + JSON.stringify(zeroBy))
console.log('  action mix: ' + Object.entries(actionMix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '))
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].ms - a[1].ms).slice(0, 8)) {
  console.log(`  ${k.padEnd(22)} n=${String(v.n).padStart(5)} mean ${(v.ms / Math.max(1, v.n)).toFixed(1).padStart(6)} ms  max ${v.max.toFixed(0).padStart(4)}  fallbacks ${v.fallbacks}`)
}
const gate = !(tier === 'normal' && vs === 'random') || winRate >= 0.95
const clean =
  rejections === 0 && oppRejections === 0 && stalls === 0 && aiFallbacks === 0 && Object.keys(unhandled).length === 0 && (tier !== 'normal' || (report.zeroActionShare < 0.02 && report.p50DecisionMs < 50))
if (!gate || !clean) {
  console.log(`GATE FAILED: ${!gate ? 'win rate below 95%; ' : ''}${!clean ? 'rejections/stalls/fallbacks/unhandled/zero-action/p50 not clean' : ''}`)
  process.exit(1)
}
console.log('GATE OK')
