// npx tsx tools/ai-watch.ts [--seed 1] [--a normal] [--b normal] [--scenario scn.tunnel-skirmish] [--game N] [--rounds 12] [--map] [--loot] [--quiet]
// Watch the AI play: one seeded game printed as a narrative (activations, moves, shots, hits, injuries, fights, doors, nerve,
// points), optionally with an ASCII map at the start of every round (digits are seat A, letters seat B, lower case a / b are
// Prone or down; # wall, + closed door, L locked door, - open door, o obstacle). `--game N` replays game N of the bench
// (same scenario, board, houses and seats; the AI tier is `--a`, the opponent `--b`). AI_TRACE=1 adds the scored candidates.
import { createGame, legalActions, query, step, view, type GameEvent, type GameState, type Seat } from '@/engine'
import { pointInPolygon } from '@/engine/geometry'
import { createAiDecider } from '../src/ai/decider'
import type { Tier } from '../src/ai/tiers'
import { realBundle, boardsFor, realSetup } from '../tests/fixtures/real'
import { pairingFor } from './ai-pairing'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1]! : fallback
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const bundle = realBundle()
const seed = arg('seed', '1')
const tierA = arg('a', 'normal') as Tier
const tierB = arg('b', 'normal') as Tier
const scenario = arg('scenario', 'scn.tunnel-skirmish')
const rounds = Number(arg('rounds', '12'))
const game = process.argv.includes('--game') ? Number(arg('game', '0')) : null
const pairing = game !== null ? pairingFor(bundle, game, [scenario], rounds) : null
const setup = pairing ? pairing.setup : realSetup({ scenarioId: scenario, boardId: boardsFor(bundle, scenario)[0]!, options: { maxRounds: rounds } })
const gameSeed = game !== null ? `${seed}-${game}` : seed
let state: GameState = createGame(setup, gameSeed, bundle).state
const seatTier = (s: Seat): Tier => (pairing ? (pairing.aiSeat === s ? tierA : tierB) : s === 'A' ? tierA : tierB)
const deciders = {
  A: createAiDecider(seatTier('A'), { seed: game !== null ? `${gameSeed}:A` : `${seed}A` }),
  B: createAiDecider(seatTier('B'), { seed: game !== null ? `${gameSeed}:B` : `${seed}B` }),
}

const nm = (id: string) => `${id}(${state.fighters[id]?.name.split(' ')[0] ?? ''})`
const counts: Record<string, number> = {}

function drawMap(): void {
  const def = state.board.def
  const rows: string[] = []
  for (let z = def.bounds.maxZ - 0.5; z > def.bounds.minZ; z -= 1) {
    let line = ''
    for (let x = def.bounds.minX + 0.5; x < def.bounds.maxX; x += 0.5) {
      let ch = '.'
      for (const w of def.walls) if (pointInPolygon({ x, z }, w.poly)) ch = '#'
      for (const d of def.doors) if (pointInPolygon({ x, z }, d.poly)) ch = state.board.doors[d.id]!.state === 'closed' ? (state.board.doors[d.id]!.locked ? 'L' : '+') : '-'
      for (const o of def.obstacles) if (pointInPolygon({ x, z }, o.poly)) ch = 'o'
      for (const c of Object.values(state.board.caskets)) if (Math.hypot(c.pos.x - x, c.pos.z - z) < 0.5 && c.state !== 'removed') ch = '$'
      for (const f of Object.values(state.fighters)) {
        if (f.location !== 'board' || Math.hypot(f.pos.x - x, f.pos.z - z) >= 0.6) continue
        const n = Number(f.id.slice(1))
        ch = f.seat === 'A' ? (f.posture === 'standing' ? String(n % 10) : 'a') : f.posture === 'standing' ? String.fromCharCode(96 + n) : 'b'
      }
      line += ch
    }
    rows.push(line)
  }
  console.log(rows.join('\n'))
}

function show(ev: GameEvent): void {
  counts[ev.type] = (counts[ev.type] ?? 0) + 1
  if (flag('quiet')) return
  const e = ev as unknown as Record<string, any>
  switch (ev.type) {
    case 'RoundStarted':
      console.log(`==== round ${e.round}`)
      if (flag('map')) drawMap()
      if (flag('loot')) console.log('   loot', query.scenarioView(state).caskets.map((c) => `${c.id}:${c.state}@${c.pos.x.toFixed(1)},${c.pos.z.toFixed(1)}${c.securedBy ? '/' + c.securedBy : ''}`).join(' '))
      break
    case 'FighterActivated': console.log(`-- ${nm(e.fighterId)} activates`); break
    case 'ActionDeclared': if (e.action !== 'shoot') console.log(`   do ${e.action}`); break
    case 'FighterMoved': console.log(`   ${e.kind} ${e.fighterId} ${e.from.x.toFixed(1)},${e.from.z.toFixed(1)} -> ${e.to.x.toFixed(1)},${e.to.z.toFixed(1)}`); break
    case 'ShootStarted': console.log(`   shoot ${e.fighterId} ${e.weaponId}`); break
    case 'TargetDeclared': console.log(`   target ${e.targetId ?? e.doorId ?? 'point'} d=${Number(e.distance).toFixed(1)} cover=${e.cover} need=${e.need}`); break
    case 'HitRolled': console.log(`   hit roll ${e.dice} need ${e.need} -> ${e.hit}`); break
    case 'FighterPinned': console.log(`   PINNED ${e.fighterId}`); break
    case 'WoundRolled': console.log(`   wound ${e.targetId} ${e.roll}/${e.need} ${e.wounded}`); break
    case 'SaveRolled': console.log(`   save ${e.targetId} ${e.roll}/${e.need} ${e.saved}`); break
    case 'InjuryRolled': console.log(`   injury ${e.targetId} ${e.faces} -> ${e.applied}`); break
    case 'FighterOutOfAction': console.log(`   OUT OF ACTION ${e.fighterId}`); break
    case 'FightStarted': console.log(`   FIGHT ${e.attackerId} vs ${JSON.stringify(e.targets)}`); break
    case 'DoorChanged': console.log(`   door ${e.doorId} ${e.state}`); break
    case 'NerveTest': console.log(`   nerve ${e.fighterId} ${e.passed ? 'held' : 'BROKE'}`); break
    case 'BottleTest': console.log(`   BOTTLE test seat ${e.seat}: ${JSON.stringify(e)}`); break
    case 'CasketOpened': console.log(`   casket ${e.casketId} opened by ${e.by}: ${e.result}`); break
    case 'PointsScored': console.log(`   POINTS ${e.seat} +${e.amount} ${e.reason}`); break
    case 'GameEnded': console.log('GAME ENDED', JSON.stringify(e.result)); break
    default: break
  }
}

for (let n = 0; state.pending && n < 8000; n++) {
  const p = state.pending
  const r = deciders[p.seat].decideSync(view(state, p.seat), p, legalActions(state, p))
  const s = step(state, r.action)
  if (s.rejection) {
    console.log('REJECTED', s.rejection, JSON.stringify(r.action))
    break
  }
  for (const ev of s.events) show(ev)
  state = s.state
}
const keys = ['ShootStarted', 'HitRolled', 'FighterPinned', 'FightStarted', 'FighterOutOfAction', 'NerveTest', 'FighterMoved', 'DoorChanged', 'CoupDeGrace', 'StrayShot', 'AmmoTest']
console.log(`rounds ${state.round}, points A ${state.players.A.points} B ${state.players.B.points}, ${state.phase}`)
console.log(keys.map((k) => `${k}=${counts[k] ?? 0}`).join(' '))
for (const [s, d] of Object.entries(deciders)) console.log(`seat ${s} (${d.tier}): decisions ${d.memory.stats.decisions}, fallbacks ${d.memory.stats.fallbacks}, unhandled ${JSON.stringify(d.memory.stats.unhandled)}`)
