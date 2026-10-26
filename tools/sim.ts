// npm run sim -- --games 50 --seed 1 [--gangs real|fixture] [--scenario scn.tunnel-skirmish] [--rounds 4]
//                [--replay tools/out/sim-report.json [index]]
// Two random-legal bots play seeded games on real starter gangs (Goliath against Escher, seats alternating) and the shipped
// boards the scenario allows, rotating through them; every step is checked against the invariants of sim-core.ts. Until the
// End phase lands in S4 a game ends by the round cap (`--rounds`, default 4).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { replay, rosterFromStarter, type Action, type EngineBundle, type GameSetup, type Seat } from '@/engine'
import { barricadePair, bundleWith, corridorWithDoor, ductwayWall, openBox } from '../tests/fixtures/boards'
import { makeSetup } from '../tests/fixtures/gang'
import { boardsFor, realBundle } from '../tests/fixtures/real'
import { runSim, type GameReport } from './sim-core'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback
}

const OUT = 'tools/out/sim-report.json'

/** Starter gangs of a house, sorted (the sim rotates through them). */
function startersOf(bundle: EngineBundle, houseId: string): string[] {
  return Object.values(bundle.starterGangs ?? {})
    .filter((g) => g.houseId === houseId)
    .map((g) => g.id)
    .sort()
}

function realSetupFor(bundle: EngineBundle, scenarioId: string, rounds: number): (game: number) => GameSetup {
  const boards = boardsFor(bundle, scenarioId)
  if (boards.length === 0) throw new Error(`no board is legal for ${scenarioId}`)
  const gol = startersOf(bundle, 'goliath')
  const esc = startersOf(bundle, 'escher')
  return (game) => {
    const swap = game % 2 === 1
    const g = gol[Math.floor(game / 2) % gol.length]!
    const e = esc[Math.floor(game / 4) % esc.length]!
    const gang = (seat: Seat, id: string) => rosterFromStarter(bundle, id, seat.toLowerCase())
    return {
      ruleset: 'n23',
      scenarioId,
      boardId: boards[game % boards.length]!,
      gangs: swap ? { A: gang('A', e), B: gang('B', g) } : { A: gang('A', g), B: gang('B', e) },
      options: { maxRounds: rounds },
    }
  }
}

/** The synthetic fixture gangs on the hand-built boards (door, barricade, ductway). */
function fixtureSetupFor(rounds: number): { bundle: EngineBundle; setupFor: (game: number) => GameSetup } {
  const boards = [openBox(), corridorWithDoor(), barricadePair(), ductwayWall()]
  const bundle = bundleWith(...boards)
  return { bundle, setupFor: (game) => makeSetup({ boardId: boards[game % boards.length]!.id, options: { maxRounds: rounds } }) }
}

function pick(): { bundle: EngineBundle; setupFor: (game: number) => GameSetup } {
  const rounds = Number(arg('rounds', '4'))
  if (arg('gangs', 'real') === 'fixture') return fixtureSetupFor(rounds)
  const bundle = realBundle()
  return { bundle, setupFor: realSetupFor(bundle, arg('scenario', 'scn.tunnel-skirmish'), rounds) }
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
  for (const g of report.failing.slice(0, 5)) {
    console.log(` game ${g.game} (${g.seed}) ended=${g.ended}`)
    for (const v of g.violations.slice(0, 5)) console.log(`   [${v.decision}] ${v.rule}: ${v.message}`)
  }
  if (report.violations > 0 || report.completed !== report.games) process.exit(1)
}
