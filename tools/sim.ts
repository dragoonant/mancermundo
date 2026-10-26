// npm run sim -- --games 20 --seed 1 [--teams real] [--decider easy|normal] [--replay tools/out/sim-report.json [index]]
// --teams real rotates every playable team (each appears in at least 4 of any 40 games); --decider makes both seats
// play the AI tier instead of the random bot (read by sim-core playGame).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { replay, type Action, type EngineBundle } from '@/engine'
import { bundleFromData } from '@/engine/bundle'
import { loadBundle } from '../src/data'
import { testBundle } from '../tests/fixtures/team'
import { realSetupFor, runSim, setupFor, type GameReport } from './sim-core'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback
}

const OUT = 'tools/out/sim-report.json'

function replayMode(path: string, index: number): void {
  const report = JSON.parse(readFileSync(path, 'utf8')) as { failing: GameReport[] }
  const g = report.failing[index]
  if (!g) {
    console.error(`no failing game at index ${index}`)
    process.exit(2)
  }
  const real = arg('teams', 'fixture') === 'real'
  const bundle: EngineBundle = real ? bundleFromData(loadBundle()) : testBundle
  const r = replay((real ? realSetupFor(bundle) : setupFor)(g.game), g.seed, g.actions as Action[], bundle)
  console.log(`replayed ${g.actions.length} actions of ${g.seed}: final hash ${r.state.hash}${r.rejection ? ` (rejected at ${r.failedAt}: ${r.rejection.reason})` : ''}`)
  for (const v of g.violations) console.log(`  [${v.decision}] ${v.rule}: ${v.message}`)
}

const replayPath = arg('replay', '')
if (replayPath) {
  replayMode(replayPath, Number(process.argv[process.argv.indexOf(replayPath) + 1] ?? 0) || 0)
} else {
  const games = Number(arg('games', '20'))
  const seed = arg('seed', '1')
  const real = arg('teams', 'fixture') === 'real'
  const bundle: EngineBundle = real ? bundleFromData(loadBundle()) : testBundle
  const report = runSim({ games, seed, setupFor: real ? realSetupFor(bundle) : setupFor, bundle })
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({ ...report, failing: report.failing }, null, 1))
  const perSec = report.ms > 0 ? ((games / report.ms) * 1000).toFixed(1) : 'inf'
  console.log(
    `sim: ${report.completed}/${report.games} games ended cleanly, ${report.decisions} decisions, ` +
      `${report.rejections} rejections, ${report.violations} violations, ${report.ms} ms (${perSec} games/s)`,
  )
  for (const g of report.failing.slice(0, 5)) {
    console.log(` game ${g.game} (${g.seed}) ended=${g.ended}`)
    for (const v of g.violations.slice(0, 5)) console.log(`   [${v.decision}] ${v.rule}: ${v.message}`)
  }
  if (report.violations > 0 || report.completed !== report.games) process.exit(1)
}
