// Scenario text for the briefing and the in-battle scenario panel. The objective paragraph is the scenario record's own text (our
// wording); crew, deployment, scoring and victory lines are built from the same record so they cannot drift from what the engine
// does, and the round structure is five fixed lines. Pure: reads data, no store, no DOM.
import type { CrewMethod, ScenarioData, ScenarioPoints } from '@/data/types'
import type { GameState, Seat } from '@/engine'
import { query } from '@/engine'

export interface Briefing {
  id: string
  name: string
  /** the scenario record's own paragraph */
  objective: string
  crew: string[]
  deployment: string[]
  scoring: string[]
  howToWin: string
  /** the same five lines for every scenario */
  rounds: string[]
  /** true when the scenario has attacker and defender roles */
  roles: boolean
}

export const ROUND_LINES: string[] = [
  'Priority: both gangs roll a die; the higher roll holds Priority, and every fighter becomes Ready.',
  'Action: the gangs take turns activating one Ready fighter each, the Priority gang first. A fighter gets two actions.',
  'Shoot, fight or charge: you see the odds before you commit. Hits wound, armour saves, then Injury dice decide who goes down.',
  'End: a gang with fighters down tests whether it bottles out; Broken fighters try to rally and Seriously Injured ones try to recover.',
  'Scoring: put fighters down or run them off, and meet the scenario\'s goal, for points. The battle ends when the scenario says so.',
]

const ROLE_WORD: Record<string, string> = { leader: 'Leader', champion: 'Champion', ganger: 'Ganger', juve: 'Juve', specialist: 'Specialist', prospect: 'Prospect' }

function crewLine(who: string, m: CrewMethod): string {
  if (m.method === 'custom') return `${who} pick up to ${m.x} fighters from their gang.`
  if (m.method === 'random') return `${who} get ${m.x} fighters drawn at random.`
  return `${who} choose ${m.x} fighters and add ${m.y ?? 'a die'} more drawn at random.`
}

/** "1 point", "D3 points", or for a per-role table "3 for a leader, 2 for a champion, 1 for anyone else". */
function pointsText(p: ScenarioPoints | undefined): string {
  if (p === undefined) return '1 point'
  if (typeof p === 'number') return `${p} point${p === 1 ? '' : 's'}`
  if (typeof p === 'string') return `${p} points`
  const groups = new Map<number, string[]>()
  for (const [role, n] of Object.entries(p.byRole)) groups.set(n as number, [...(groups.get(n as number) ?? []), ROLE_WORD[role] ?? role])
  const rows = [...groups.entries()].sort((a, b) => b[0] - a[0])
  return rows.map(([n, roles], i) => `${n} for ${i === rows.length - 1 && rows.length > 1 ? 'any other fighter' : `a ${roles.join(' or ').toLowerCase()}`}`).join(', ')
}

export function briefingFor(s: ScenarioData): Briefing {
  const crew: string[] = []
  if (s.crews.both) crew.push(crewLine('Both gangs', s.crews.both))
  if (s.crews.attacker) crew.push(crewLine('The attackers', s.crews.attacker))
  if (s.crews.defender) crew.push(crewLine('The defenders', s.crews.defender))
  if (s.crewCap) crew.push('The size of each crew is capped by a roll before the crews are picked.')

  const deployment: string[] = []
  const d = s.deployment
  if (s.roles) deployment.push(d.defenderFirst ? 'The defenders choose a half of the board and deploy first; the attackers take the other half.' : 'The attackers deploy first.')
  else deployment.push('The winner of the roll-off chooses whether to set up first or second, and picks a half of the board.')
  if (d.kind === 'standard') deployment.push(`Fighters set up in their own half, at least ${d.minFromCentreline ?? 12}" from the centre line.`)
  else deployment.push(`Each gang picks an outer tile and sets up within ${d.withinOfEdge ?? 3}" of its outer edge, at least ${d.enemyClearance ?? 6}" from the enemy.`)
  if (s.caskets) deployment.push(`${s.caskets.count} loot caskets are placed on the board, at least ${s.caskets.minApart}" apart and ${s.caskets.minFromEdge}" from the edge.`)

  const scoring: string[] = []
  const who = (x?: string) => (x === 'attacker' ? 'the attackers score' : x === 'defender' ? 'the defenders score' : 'a gang scores')
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  for (const r of s.scoring) {
    switch (r.on) {
      case 'fighterOutOfAction':
        scoring.push(`For each enemy fighter taken Out of Action, ${who(r.seat)} ${pointsText(r.points)}.`)
        break
      case 'fighterFled':
        scoring.push(`For each enemy fighter that flees the field, ${who(r.seat)} ${pointsText(r.points)}.`)
        break
      case 'casketOpened':
        scoring.push(`${cap(who(r.seat))} ${pointsText(r.points)} for each casket cracked open, whatever it held.`)
        break
      case 'casketSecured':
        scoring.push(`${cap(who(r.seat))} ${pointsText(r.points)} for each casket brought back to its own deployment tile.`)
        break
      case 'lastGangStanding':
        scoring.push(`${cap(who(r.seat))} ${pointsText(r.points)} for being the last gang with fighters on the board.`)
        break
    }
  }

  let howToWin: string
  if ('by' in s.victory) howToWin = s.victory.by === 'caskets' ? 'Have the most caskets secured on your own tile when the battle ends. Ties fall back on points.' : 'Have more points than the other gang when the battle ends. Level points is a draw.'
  else howToWin = s.id.includes('smash') ? 'The attackers win by cracking three caskets before the battle ends; otherwise the defenders hold.' : 'The scenario has its own victory test; the score panel shows how it stands.'

  return { id: s.id, name: s.name, objective: s.text, crew, deployment, scoring, howToWin, rounds: ROUND_LINES, roles: s.roles }
}

// ---------------------------------------------------------------- in battle

export interface ScenarioProgress {
  points: Record<Seat, number>
  caskets: { opened: number; secured: number } | null
  lockedWinner: Seat | null
  lockedReason: string | null
  /** whatever `query.scenarioView` reports beyond the above (null while the engine has none) */
  view: Record<string, unknown> | null
}

export function scenarioProgress(state: GameState): ScenarioProgress {
  const sc = state.scenario
  const fn = (query as unknown as Record<string, ((s: GameState) => unknown) | undefined>).scenarioView
  let view: Record<string, unknown> | null = null
  if (fn) {
    try {
      const r = fn(state)
      if (r && typeof r === 'object') view = r as Record<string, unknown>
    } catch {
      view = null
    }
  }
  const hasCaskets = Object.keys(state.board.caskets).length > 0
  return {
    points: { A: state.players.A.points, B: state.players.B.points },
    caskets: hasCaskets ? { ...sc.caskets } : null,
    lockedWinner: sc.locked?.winner ?? null,
    lockedReason: sc.locked?.reason ?? null,
    view,
  }
}
