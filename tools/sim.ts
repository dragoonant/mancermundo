// npm run sim -- --games 50 --seed 1 [--gangs real|fixture] [--scenario all|scn.tunnel-skirmish|...] [--rounds N]
//                [--replay tools/out/sim-report.json [index]]
// Two random-legal bots play seeded games on real starter gangs (Goliath against Escher, seats alternating) and the shipped
// boards each scenario allows; with `--scenario all` (the default) the games rotate through all three scenarios and, within a
// scenario, through every legal board. Every step is checked against the invariants of sim-core.ts. There is no round limit:
// every game must end by its scenario within 20 rounds and 4000 decisions (`--rounds N` sets the old short-game cap).
// The report lists, per scenario, the winner split, rounds, the round the first gang bottled, casualties and how games ended.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { replay, type Action, type EngineBundle, type GameSetup } from '@/engine'
import { barricadePair, bundleWith, corridorWithDoor, ductwayWall, openBox } from '../tests/fixtures/boards'
import { makeSetup } from '../tests/fixtures/gang'
import { realBundle } from '../tests/fixtures/real'
import { realSetupFor, SCENARIOS } from './sim-setup'
import { runSim, type GameReport, type GameSummary } from './sim-core'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback
}

const OUT = 'tools/out/sim-report.json'

/** The synthetic fixture gangs on the hand-built boards (door, barricade, ductway). */
function fixtureSetupFor(rounds: number | undefined): { bundle: EngineBundle; setupFor: (game: number) => GameSetup } {
  const boards = [openBox(), corridorWithDoor(), barricadePair(), ductwayWall()]
  const bundle = bundleWith(...boards)
  return { bundle, setupFor: (game) => makeSetup({ boardId: boards[game % boards.length]!.id, ...(rounds !== undefined ? { options: { maxRounds: rounds } } : {}) }) }
}

function pick(): { bundle: EngineBundle; setupFor: (game: number) => GameSetup } {
  const roundsArg = arg('rounds', '')
  const rounds = roundsArg ? Number(roundsArg) : undefined
  if (arg('gangs', 'real') === 'fixture') return fixtureSetupFor(rounds)
  const bundle = realBundle()
  const which = arg('scenario', 'all')
  return { bundle, setupFor: realSetupFor(bundle, which === 'all' ? SCENARIOS : [which], rounds) }
}

function replayMode(path: string, index: number): void {
  const report = JSON.parse(readFileSync(path, 'utf8')) as { failing: GameReport[] }
  const g = report.failing[index]
  if (!g) {
    console.error(`no failing game at index ${index}`)
    process.exit(2)
  }
  const { bundle, setupFor } = pick()
  const r = replay(setupFor(g.game), g.seed, g.actions as Action[], bundle)
  console.log(`replayed ${g.actions.length} actions of ${g.seed}: final hash ${r.state.hash}${r.rejection ? ` (rejected at ${r.failedAt}: ${r.rejection.reason})` : ''}`)
  for (const v of g.violations) console.log(`  [${v.decision}] ${v.rule}: ${v.message}`)
}

const mean = (xs: number[]): string => (xs.length === 0 ? '-' : (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1))
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length))

/** The per-scenario table: winners by seat and by house, how games ended, rounds, bottle round, casualties. */
function scenarioTable(summaries: GameSummary[]): string[] {
  const lines = [
    `${pad('scenario', 22)}${pad('games', 6)}${pad('A/B/draw', 11)}${pad('gol/esc/draw', 14)}${pad('rounds', 8)}${pad('max', 5)}${pad('bottled', 9)}${pad('bottle rd', 10)}${pad('casualties', 11)}${pad('decisions', 10)}ended by`,
  ]
  for (const id of [...new Set(summaries.map((s) => s.scenarioId))]) {
    const rows = summaries.filter((s) => s.scenarioId === id)
    const count = (f: (s: GameSummary) => boolean) => rows.filter(f).length
    const bottled = rows.filter((r) => r.bottleRound !== null)
    const reasons = [...new Set(rows.map((r) => r.reason ?? 'none'))].map((k) => `${k} ${count((r) => (r.reason ?? 'none') === k)}`).join(', ')
    lines.push(
      pad(id, 22) +
        pad(String(rows.length), 6) +
        pad(`${count((r) => r.winner === 'A')}/${count((r) => r.winner === 'B')}/${count((r) => r.winner === 'draw')}`, 11) +
        pad(`${count((r) => r.winnerHouse === 'goliath')}/${count((r) => r.winnerHouse === 'escher')}/${count((r) => r.winner === 'draw')}`, 14) +
        pad(mean(rows.map((r) => r.rounds)), 8) +
        pad(String(Math.max(...rows.map((r) => r.rounds))), 5) +
        pad(`${bottled.length} (${bottled.filter((r) => r.voluntaryBottle).length} vol)`, 9) +
        pad(mean(bottled.map((r) => r.bottleRound!)), 10) +
        pad(mean(rows.map((r) => r.casualties)), 11) +
        pad(mean(rows.map((r) => r.decisions)), 10) +
        `${reasons}${count((r) => r.lockedWin) > 0 ? `; locked wins ${count((r) => r.lockedWin)}` : ''}`,
    )
  }
  return lines
}

const replayPath = arg('replay', '')
if (replayPath) {
  replayMode(replayPath, Number(process.argv[process.argv.indexOf(replayPath) + 1] ?? 0) || 0)
} else {
  const games = Number(arg('games', '20'))
  const seed = arg('seed', '1')
  const { bundle, setupFor } = pick()
  const report = runSim({ games, seed, setupFor, bundle })
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({ ...report, failing: report.failing }, null, 1))
  const perSec = report.ms > 0 ? ((games / report.ms) * 1000).toFixed(1) : 'inf'
  console.log(
    `sim: ${report.completed}/${report.games} games ended cleanly, ${report.decisions} decisions, ` +
      `${report.rejections} rejections, ${report.violations} violations, ${report.ms} ms (${perSec} games/s)`,
  )
  console.log(
    '     ' +
      Object.entries(report.stats)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
  )
  // casualties per game (Seriously Injured + Out of Action + fled records of the casualty log)
  const perGame = report.casualtiesPerGame
  console.log(`     casualties per game: ${perGame.join(' ')} (mean ${(perGame.reduce((a, b) => a + b, 0) / Math.max(1, perGame.length)).toFixed(2)})`)
  for (const line of scenarioTable(report.summaries)) console.log(line)
  for (const g of report.failing.slice(0, 5)) {
    console.log(` game ${g.game} (${g.seed}) ended=${g.ended}`)
    for (const v of g.violations.slice(0, 5)) console.log(`   [${v.decision}] ${v.rule}: ${v.message}`)
  }
  if (report.violations > 0 || report.completed !== report.games) process.exit(1)
}
