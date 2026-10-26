// Label building: every sentence the UI shows about a decision, option, event or rejection. Own wording
// only (no Games Workshop text). Unknown decision kinds and label keys degrade to a readable generic form,
// never a crash, so decision kinds added by the engine later still render as an option list.
import { tokenDef } from '../ui/tokenDefs'
import { poolLabel, setAsideWording } from '../teams'
import type { DecisionKind, DecisionOption, GameEvent, GameState, PendingDecision, Rejection, Seat } from '@/engine'

export const SEAT_NAME: Record<Seat, string> = { A: 'Seat A', B: 'Seat B' }

export function humanize(key: string): string {
  const last = key.split(/[.:]/).filter(Boolean).pop() ?? key
  const spaced = last.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export const ACTION_LABEL: Record<string, string> = {
  reposition: 'Reposition',
  dash: 'Dash',
  fallBack: 'Fall Back',
  charge: 'Charge',
  guard: 'Guard',
  shoot: 'Shoot',
  fight: 'Fight',
  end: 'End activation',
}

export const ACTION_ORDER_FALLBACK = ['reposition', 'dash', 'fallBack', 'charge', 'guard', 'shoot', 'fight']

/** One plain sentence per universal action. */
export const ACTION_HELP: Record<string, string> = {
  reposition: 'Walk up to your Move stat. Not allowed from inside an enemy control range.',
  dash: 'A short sprint of up to 3 inches, no climbing. Not allowed from inside an enemy control range.',
  fallBack: 'Retreat out of an enemy control range. Costs 2 AP.',
  charge: 'Run at the enemy: Move plus 2 inches, and you must finish inside an enemy control range. Engage only.',
  guard: 'Hold your fire and answer an enemy action later in the turning point. Engage only.',
  shoot: 'Fire a ranged weapon at a visible enemy.',
  fight: 'Strike an enemy inside your control range.',
  end: 'Stop acting; this operative becomes expended.',
}

export const ORDER_HELP: Record<'engage' | 'conceal', string> = {
  engage:
    'Engage: can Charge, Guard and Shoot freely and can counteract later. Enemies can target it even in cover (it keeps the cover save).',
  conceal:
    'Conceal: harder to target while in cover and out of sight, but it cannot Charge or Shoot (unless the weapon is Silent) and cannot counteract.',
}

const KIND_TITLE: Record<string, { title: string; hint: string }> = {
  'setup.initiative': { title: 'Roll off for setup', hint: 'Both sides roll a die. The higher roll decides who holds initiative during set-up.' },
  'setup.decideInitiative': { title: 'Choose set-up initiative', hint: 'You won the roll-off. Decide which side holds initiative for set-up.' },
  'setup.dropZone': { title: 'Choose a drop zone', hint: 'Pick the edge of the killzone you deploy from.' },
  'setup.deploy': { title: 'Deploy operatives', hint: 'Select an operative, then click inside the highlighted drop zone to set it down.' },
  'setup.equipMarker': { title: 'Place equipment', hint: 'Place this equipment marker.' },
  'setup.objective': { title: 'Place an objective', hint: 'Pick one of the highlighted spots for this objective marker.' },
  'strategy.initiative': { title: 'Roll for initiative', hint: 'Both sides roll a die at the start of each turning point.' },
  'strategy.decideInitiative': { title: 'Tied: choose initiative', hint: 'The roll tied; you decide who takes initiative this turning point.' },
  'strategy.gambit': { title: 'Strategic gambit', hint: 'Spend CP on a gambit, or pass. The step ends after two passes in a row.' },
  'firefight.activate': { title: 'Choose an operative', hint: 'Pick a ready operative to activate (click it on the board or choose below).' },
  'firefight.order': { title: 'Give an order', hint: 'Choose Engage or Conceal for this activation.' },
  'firefight.action': { title: 'Choose an action', hint: 'Spend AP on actions, or end the activation.' },
  'move.path': { title: 'Plan the move', hint: 'Click the board to lay straight-line steps. Each step is rounded up to a whole inch.' },
  'shoot.weapon': { title: 'Choose a weapon', hint: 'Pick the ranged weapon to shoot with.' },
  'shoot.target': { title: 'Choose a target', hint: 'Pick a valid enemy target.' },
  'shoot.coverSave': { title: 'Cover save', hint: 'Keep a cover save without rolling, or roll all your defence dice.' },
  'shoot.block': { title: 'Block attacks', hint: 'Assign successful defence dice to block attack dice, or let the engine choose the best block.' },
  'fight.target': { title: 'Choose a fight target', hint: 'Pick an enemy inside your control range.' },
  'fight.weapon': { title: 'Choose a melee weapon', hint: 'Pick the melee weapon to fight with.' },
  'fight.resolve': { title: 'Strike or block', hint: 'Spend one success: strike the enemy or block one of their dice.' },
  'dice.reroll': { title: 'Re-roll offered', hint: 'An ability lets you re-roll some dice.' },
  'dice.commandReroll': { title: 'Command re-roll', hint: 'Spend 1 CP to re-roll one die, or pass.' },
  'weapon.choice': { title: 'Weapon rule choice', hint: 'A weapon rule lets you choose how it applies.' },
  'ploy.firefight': { title: 'Firefight ploy', hint: 'Use a ploy now, or pass.' },
  'guard.interrupt': { title: 'Guard interrupt', hint: 'An enemy acted. Interrupt with an operative on Guard, or decline.' },
  'marker.pickUp': { title: 'Pick up marker', hint: 'Pick up the marker.' },
  'marker.place': { title: 'Place marker', hint: 'Choose where the marker goes.' },
  'mission.action': { title: 'Mission action', hint: 'Perform the mission action.' },
  'ability.choice': { title: 'Make a choice', hint: 'A team rule or ability needs a decision.' },
  confirm: { title: 'Confirm', hint: 'Acknowledge to continue.' },
}

/** One line on why the decision matters (shown under the hint). Dice and defence decisions always have one. */
export const KIND_WHY: Record<string, string> = {
  'shoot.coverSave': 'A kept cover save is a guaranteed success, so it protects you even on cold dice; rolling every die can do better or worse.',
  'shoot.block': 'Every hit you leave unblocked becomes damage, and a critical hit hurts more, so how you pair saves with hits sets the wounds you take.',
  'fight.resolve': 'Each success is spent once, either to wound them or to cancel one of their hits, so the order you spend them in decides who is hurt.',
  'dice.reroll': 'A re-roll replaces the die and the new result stands, even if it is worse, so keep the dice that already count.',
  'dice.commandReroll': 'Command points are few and also pay for ploys, so spend one only on a roll that decides something.',
  'shoot.target': "Cover and obscured shots lose hits, and the odds shown are the engine's own numbers for this exact shot.",
  'shoot.weapon': 'Profiles differ in attacks, hit and damage, and their special rules change how the shot plays out.',
  'firefight.action': 'Each activation has limited AP, so what you spend them on decides what this operative achieves before it is expended.',
  'firefight.order': 'Engage keeps every action open; Conceal hides the operative better but cannot Charge or Shoot.',
  'guard.interrupt': 'Answering now uses up the Guard, but it lets you act before the enemy finishes.',
  'strategy.gambit': 'Command points are limited, so each gambit or ploy is a trade-off against the next one.',
  'ploy.firefight': 'Command points are limited, so each ploy is a trade-off against the next one.',
}

export function decisionInfo(kind: DecisionKind | string): { title: string; hint: string; why?: string } {
  const base = KIND_TITLE[kind] ?? { title: humanize(kind), hint: 'Choose one of the options below.' }
  const why = KIND_WHY[kind]
  return why ? { ...base, why } : base
}

const OPTION_KEY: Record<string, string> = {
  'setup.rollOff': 'Roll the die',
  'setup.initiativeSelf': 'I take initiative',
  'setup.initiativeOpponent': 'Opponent takes initiative',
  'setup.dropZone': 'Deploy from this zone',
  'strategy.rollInitiative': 'Roll the die',
  'strategy.initiativeSelf': 'I take initiative',
  'strategy.initiativeOpponent': 'Opponent takes initiative',
  'order.engage': 'Engage',
  'order.conceal': 'Conceal',
  'firefight.counteract': 'Counteract',
  'action.end': 'End activation',
  'action.declineCounteract': 'Decline the counteraction',
  'cover.retain': 'Keep one cover save (no roll)',
  'cover.roll': 'Roll all defence dice',
  'cover.retainCrit': 'Keep one cover save as a critical',
  'cover.retainTwo': 'Keep two cover saves',
  'choice.cover': 'Count the target as in cover',
  'choice.obscured': 'Count the target as obscured',
  'block.auto': 'Auto block (the engine picks the best block)',
  'reroll.command': 'Command Re-roll (1 CP)',
}

export function opName(state: GameState | null, id: string | undefined | null): string {
  if (!id) return 'an operative'
  const op = state?.operatives[id]
  return op ? `${op.name} (${op.id})` : id
}

/** "North", "East"... for a drop zone, from where its polygon sits on the mat (ids are map-specific). */
export function zoneName(state: GameState | null, zoneId: string): string {
  const z = state?.map.dropZones.find((d) => d.id === zoneId)
  if (!z || z.polygon.length === 0) return humanize(zoneId)
  const cx = z.polygon.reduce((a, p) => a + p.x, 0) / z.polygon.length
  const cz = z.polygon.reduce((a, p) => a + p.z, 0) / z.polygon.length
  const word = Math.abs(cx) >= Math.abs(cz) ? (cx < 0 ? 'West' : 'East') : cz < 0 ? 'North' : 'South'
  return word
}

export function gambitName(state: GameState | null, id: string): string {
  return state?.data.gambits.find((g) => g.id === id)?.name ?? humanize(id)
}

/** Button text for a decision option. */
export function optionLabel(opt: DecisionOption, state: GameState | null, pending?: PendingDecision): string {
  const data = opt.data ?? {}
  const payload = opt.action.payload as Record<string, unknown>
  const name = typeof data.name === 'string' ? data.name : null
  const cost = typeof data.cost === 'number' ? data.cost : null
  switch (opt.action.type) {
    case 'firefight.activate': {
      const who = opName(state, String(payload.operativeId ?? opt.id))
      // M9 batch C: a team's alternative to counteracting (Farstalker order change)
      if (payload.alternative !== undefined) return `Instead of counteracting: ${who}${typeof data.option === 'string' ? ` (${humanize(data.option)})` : ''}`
      return payload.counteract ? `Counteract with ${who}` : `Activate ${who}`
    }
    case 'setup.dropZone':
      return `${zoneName(state, String(payload.zoneId ?? opt.id))} drop zone`
    case 'strategy.gambit':
      return `${name ?? gambitName(state, String(payload.gambitId ?? opt.id))}${cost !== null ? ` (${cost} CP)` : ''}`
    case 'firefight.action': {
      const id = String(payload.action ?? opt.id)
      return `${ACTION_LABEL[id] ?? humanize(id)}${cost !== null && id !== 'end' ? ` (${cost} AP)` : ''}`
    }
    case 'shoot.weapon':
      return name ?? humanize(String(payload.weaponId ?? opt.id))
    case 'shoot.target':
      return opName(state, String(payload.targetId ?? opt.id))
    default:
      break
  }
  if (opt.labelKey === 'block.leave' && Array.isArray(payload.unblocked)) {
    const [n, c] = payload.unblocked as number[]
    return `Leave ${n} normal and ${c} critical unblocked`
  }
  if (opt.labelKey.startsWith('reroll.') && opt.labelKey !== 'reroll.command') {
    const v = data.value ?? data.result
    const count = typeof data.count === 'number' ? ` ${data.count}` : ''
    const src = typeof data.source === 'string' ? gambitName(state, data.source) : 'ability'
    return `Re-roll${count}${v !== undefined ? ` (the ${String(v)})` : ''} with ${src}`
  }
  if (opt.labelKey === 'reroll.command' && data.value !== undefined) return `Command Re-roll the ${String(data.value)} (1 CP)`
  const known = OPTION_KEY[opt.labelKey]
  if (known) return known
  if (name) return `${name}${cost !== null ? ` (${cost})` : ''}`
  void pending
  return humanize(opt.labelKey || opt.id)
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

export function rulesLine(rules: unknown): string {
  if (!Array.isArray(rules)) return ''
  return (rules as { rule: string; x?: number; inches?: number; target?: number }[])
    .map((r) => `${humanize(r.rule)}${r.inches !== undefined ? ` ${r.inches}″` : r.x !== undefined ? ` ${r.x}` : r.target !== undefined ? ` ${r.target}+` : ''}`)
    .join(', ')
}

/** Detail line under an option button: the engine's own numbers (odds, cover, damage), never computed here. */
export function optionDetail(opt: DecisionOption): string {
  const d = opt.data ?? {}
  const bits: string[] = []
  switch (opt.action.type) {
    case 'shoot.weapon': {
      const dmg = d.dmg as { normal: number; crit: number } | undefined
      bits.push(`A${String(d.atk)} ${String(d.hit)}+${dmg ? ` ${dmg.normal}/${dmg.crit}` : ''}`)
      const r = rulesLine(d.rules)
      if (r) bits.push(r)
      if (typeof d.targets === 'number') bits.push(`${d.targets} target${d.targets === 1 ? '' : 's'}`)
      return bits.join(' · ')
    }
    case 'shoot.target': {
      if (typeof d.distance === 'number') bits.push(`${d.distance.toFixed(1)}″`)
      if (d.inCover) bits.push(d.improvedCover ? 'improved cover' : 'in cover')
      if (d.obscured) bits.push('obscured')
      if (d.forcedChoice) bits.push('defender chooses cover or obscured')
      if (d.vantageAccurate) bits.push('vantage')
      if (typeof d.expectedDamage === 'number') bits.push(`exp. damage ${d.expectedDamage.toFixed(1)}`)
      if (typeof d.killProbability === 'number') bits.push(`kill ${pct(d.killProbability)}`)
      if (bits.length === 0) bits.push('clear shot')
      return bits.join(' · ')
    }
    case 'shoot.block': {
      if (typeof d.damage === 'number') bits.push(`takes ${d.damage} damage`)
      if (typeof d.unblockedNormal === 'number') bits.push(`unblocked ${d.unblockedNormal} normal, ${String(d.unblockedCrit)} crit`)
      return bits.join(' · ')
    }
    default:
      break
  }
  for (const [k, v] of Object.entries(d)) {
    if (['name', 'cost'].includes(k) || v === null || v === undefined) continue
    if (typeof v === 'number') bits.push(`${humanize(k)} ${/prob|odds|chance/i.test(k) ? pct(v) : Number.isInteger(v) ? v : v.toFixed(2)}`)
    else if (typeof v === 'boolean') {
      if (v) bits.push(humanize(k))
    } else if (typeof v === 'string') bits.push(`${humanize(k)} ${v}`)
  }
  return bits.join(' · ')
}

/** Compact "key: value" facts out of pending.context for the generic prompt (odds, numbers, ids). */
export function contextFacts(context: Record<string, unknown>, state: GameState | null): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = []
  const name = (x: unknown): string => {
    if (typeof x !== 'string') return typeof x === 'object' ? JSON.stringify(x) : String(x)
    if (state?.operatives[x]) return opName(state, x)
    if (state?.data.weapons[x]) return weaponName(state, x)
    return x
  }
  for (const [k, v] of Object.entries(context)) {
    if (v === null || v === undefined || v === false) continue
    let text: string
    if (typeof v === 'number') text = String(v)
    else if (typeof v === 'boolean') text = 'yes'
    else if (Array.isArray(v)) text = v.map(name).join(', ')
    else if (typeof v === 'object') text = JSON.stringify(v)
    else text = name(v)
    if (text.length > 160) text = `${text.slice(0, 157)}...`
    out.push({ key: humanize(k.replace(/Ids?$/, '')), value: text })
  }
  return out
}

export function rejectionText(r: Rejection): string {
  if (r.code === 'E_TODO') return `Not implemented yet: ${r.reason}`
  return r.reason || r.code
}

function dice(d: number[]): string {
  return d.join(' ')
}

export function weaponName(state: GameState | null, id: string | null | undefined): string {
  if (!id) return 'a weapon'
  return state?.data.weapons[id]?.name ?? humanize(id)
}

/** "5 3* 2 (1 crit, 1 hit)": dice with their classes (crit marked *, failed dice struck through as x). */
export function diceLine(dice: (number | null)[], kinds: string[]): string {
  const faces = dice.map((d, i) => (d === null ? '-' : `${d}${kinds[i] === 'crit' ? '*' : kinds[i] === 'fail' ? 'x' : ''}`))
  const crit = kinds.filter((k) => k === 'crit').length
  const norm = kinds.filter((k) => k === 'normal').length
  return `${faces.join(' ')} (${crit} crit, ${norm} hit)`
}

/** One feed line for an event, or null when the event is not worth showing. */
export function describeEvent(ev: GameEvent, state: GameState | null): string | null {
  const who = (id: string) => opName(state, id)
  switch (ev.type) {
    case 'GameCreated':
      return `Battle created (seed ${ev.seed}).`
    case 'TurningPointStarted':
      return `Turning point ${ev.number} begins.`
    case 'TurningPointEnded':
      return `Turning point ${ev.number} ends.`
    case 'PhaseStarted':
      return `${humanize(ev.name)} phase.`
    case 'InitiativeDecided':
      return `${SEAT_NAME[ev.holder]} holds initiative${ev.setup ? ' (set-up)' : ''}.`
    case 'GameEnded':
      return ev.result.winner === 'draw' ? 'The battle ends in a draw.' : `${SEAT_NAME[ev.result.winner]} wins the battle.`
    case 'DropZoneChosen':
      return `${ev.seat ? SEAT_NAME[ev.seat] : 'A seat'} takes the ${zoneName(state, ev.zoneId)} drop zone.`
    case 'OperativeDeployed':
      return `${who(ev.operativeId)} deployed.`
    case 'CpChanged':
      return `${ev.seat ? SEAT_NAME[ev.seat] : ''} ${ev.delta >= 0 ? '+' : ''}${ev.delta} CP (now ${ev.cp}).`.trim()
    case 'GambitUsed':
      return `${ev.seat ? SEAT_NAME[ev.seat] : ''} plays ${gambitName(state, ev.gambitId)}.`.trim()
    case 'GambitPassed':
      return `${ev.seat ? SEAT_NAME[ev.seat] : 'A seat'} passes.`
    case 'OperativesReadied':
      return 'All operatives are ready.'
    case 'OperativeActivated':
      return `${who(ev.operativeId)} activates.`
    case 'OrderSet':
      return `${who(ev.operativeId)} is on ${humanize(ev.order)}.`
    case 'ActionDeclared':
      return `${who(ev.operativeId)}: ${ACTION_LABEL[ev.action] ?? humanize(ev.action)}.`
    case 'ActionCancelled':
      return `${who(ev.operativeId)} cancels ${ACTION_LABEL[ev.action] ?? humanize(ev.action)}.`
    case 'OperativeExpended':
      return `${who(ev.operativeId)} is expended.`
    case 'Counteracted':
      return `${who(ev.operativeId)} counteracts.`
    case 'CounteractSkipped':
      return 'Counteraction skipped.'
    case 'GuardSet':
      return `${who(ev.operativeId)} is on Guard.`
    case 'GuardCleared':
      return `${who(ev.operativeId)} leaves Guard.`
    case 'OperativeMoved': {
      const kinds = ev.segments.filter((s) => s.kind !== 'walk').map((s) => s.kind)
      return `${who(ev.operativeId)} moves ${ev.cost}/${ev.maxInches} in${kinds.length ? ` (${[...new Set(kinds)].join(', ')})` : ''}.`
    }
    case 'ControlChanged':
      return `Marker ${humanize(ev.markerId)}: ${ev.controller ? SEAT_NAME[ev.controller] : 'nobody'} controls it.`
    case 'DiceRolled':
      return `Roll (${humanize(ev.purpose)}): ${dice(ev.dice)}`
    case 'ActionRejected':
      return `Rejected: ${ev.reason}`
    case 'ShootStarted':
      return `${who(ev.operativeId)} shoots with ${weaponName(state, ev.weaponId)}.`
    case 'TargetSelected':
      return `${who(ev.operativeId)} targets ${who(ev.targetId)} at ${ev.distance.toFixed(1)}″${ev.inCover ? (ev.improvedCover ? ', improved cover' : ', in cover') : ''}${ev.obscured ? ', obscured' : ''}.`
    case 'AttackDiceRolled':
      return `${who(ev.operativeId)} attack (need ${ev.need}+): ${diceLine(ev.dice, ev.kinds)}`
    case 'DefenceDiceRolled':
      return `${who(ev.targetId)} defence (need ${ev.need}+): ${diceLine(ev.dice, ev.kinds)}`
    case 'DiceRerolled':
      return `${who(ev.operativeId)} re-rolls ${ev.indexes.length} ${ev.side} di${ev.indexes.length === 1 ? 'e' : 'ce'}.`
    case 'AttackRetained':
      return `${who(ev.targetId)} is hit by ${ev.normal} normal and ${ev.crit} critical retained successes.`
    case 'CoverSaveRetained':
      return `${who(ev.targetId)} keeps ${ev.normal + ev.crit} cover save${ev.normal + ev.crit === 1 ? '' : 's'}${ev.crit ? ' (critical)' : ''}.`
    case 'DiceBlocked':
      return `${who(ev.targetId)} blocks ${ev.blockedNormal} normal, ${ev.blockedCrit} critical; ${ev.unblockedNormal} normal, ${ev.unblockedCrit} critical get through.`
    case 'DamageInflicted':
      return `${who(ev.operativeId)} takes ${ev.amount} damage (${humanize(ev.source)}), ${ev.wounds} wounds left.`
    case 'FightStarted':
      return `${who(ev.operativeId)} fights ${who(ev.targetId)}.`
    case 'Struck':
      return `${who(ev.operativeId)} strikes ${who(ev.targetId)} with a ${ev.die} success for ${ev.amount}.`
    case 'Blocked':
      return `${who(ev.operativeId)} blocks${ev.against ? ` a ${ev.against}` : ''} with a ${ev.die} success.`
    case 'ShockDiscard':
      return `${who(ev.operativeId)} discards a ${ev.discarded} success (Shock).`
    case 'ChoiceMade':
      return `${SEAT_NAME[ev.seat]} chooses ${humanize(ev.option)}.`
    case 'AplModified':
      return `${who(ev.operativeId)} APL ${ev.delta >= 0 ? '+' : ''}${ev.delta} (${humanize(ev.reason)}).`
    case 'WeaponLimited':
      return `${who(ev.operativeId)} has used ${weaponName(state, ev.weaponId)} ${ev.uses} time${ev.uses === 1 ? '' : 's'}.`
    case 'OperativeInjured':
      return `${who(ev.operativeId)} is injured.`
    case 'OperativeIncapacitated':
      return `${who(ev.operativeId)} is incapacitated.`
    case 'OperativeRemoved':
      return `${who(ev.operativeId)} is removed from the killzone.`
    case 'GuardInterrupt':
      return `${who(ev.operativeId)} interrupts from Guard.`
    case 'MarkerPickedUp':
      return `${who(ev.operativeId)} picks up ${humanize(ev.markerId)}.`
    case 'MarkerPlaced':
      return `${ev.operativeId ? who(ev.operativeId) : 'A marker'}: ${humanize(ev.markerId)} placed.`
    case 'MarkerRemoved':
      return `${humanize(ev.markerId)} removed (${humanize(ev.reason)}).`
    case 'ObjectivePlaced':
      return `Objective marker ${humanize(ev.markerId)} placed.`
    case 'EquipmentPlaced':
      return `${humanize(ev.equipmentId)} placed.`
    case 'EquipmentSkipped':
      return `${humanize(ev.equipmentId)} skipped.`
    case 'MissionChosen':
      return `Mission ${humanize(ev.missionId)}, map ${ev.mapId}.`
    case 'MissionActionPerformed':
      return `${who(ev.operativeId)} performs ${humanize(ev.action)} at ${humanize(ev.markerId)}.`
    case 'KillGradeChanged':
      return `Kill grade ${ev.grade} (${ev.kills} down).`
    case 'VpScored':
      return `${ev.seat ? SEAT_NAME[ev.seat] : 'A seat'} scores ${ev.amount} VP (${humanize(ev.ruleId)}); now ${ev.vp}.`
    case 'MineTriggered':
      return `A mine hits ${who(ev.operativeId)} for ${ev.damage}.`
    case 'AbilityUsed': {
      // Covert Guises: the cult's D3, rolled at set-up and shown to both players
      const roll = /^D3: (\d)$/.exec(ev.detail ?? '')
      if (roll && /covert-guises$/.test(ev.abilityId)) return `Covert Guises: the cult rolled a D3 and got ${roll[1]}. In the first turning point that many Devotees in its drop zone may take a free Reposition.`
      // the record's own name when the data has one, and a "mutant:chitinous" style detail read as words
      const named = state?.data.abilities?.[ev.abilityId]?.name ?? state?.data.ploys?.[ev.abilityId]?.name ?? state?.data.equipment?.[ev.abilityId]?.name
      const title = named ? named.charAt(0) + named.slice(1).toLowerCase() : humanize(ev.abilityId)
      const detail = ev.detail && /^[a-z-]+(:[a-z-]+)+$/.test(ev.detail) ? ev.detail.split(':').map((x) => x.replace(/-/g, ' ')).join(', ') : ev.detail
      return `${ev.operativeId ? `${who(ev.operativeId)}: ` : ''}${title}${detail ? ` (${detail})` : ''}.`
    }
    case 'PloyUsed': {
      const ploy = state?.data.ploys?.[ev.ployId]?.name
      return `${ploy ? ploy.charAt(0) + ploy.slice(1).toLowerCase() : humanize(ev.ployId)} is used.`
    }
    case 'TokenChanged': {
      if (ev.delta === 0) return null
      const d = tokenDef(ev.kind)
      const n = Math.abs(ev.delta)
      const noun = `${d.label} token${n === 1 ? '' : 's'}`
      return ev.delta > 0
        ? `${who(ev.operativeId)} gains ${n === 1 ? 'a' : n} ${noun} (${SEAT_NAME[ev.owner]}), now ${ev.count}.`
        : `${who(ev.operativeId)} loses ${n === 1 ? 'a' : n} ${noun} (${SEAT_NAME[ev.owner]}), ${ev.count} left.`
    }
    case 'WoundsRegained':
      return `${who(ev.operativeId)} regains ${ev.amount} wound${ev.amount === 1 ? '' : 's'} (${ev.wounds} now).`
    case 'OperativeSetAside':
      return `${who(ev.operativeId)} is set aside, out of the killzone.`
    case 'OperativeTransformed': {
      // batch D prep: an operative changed datacard (Mutation)
      const card = (n: string) => state?.data.datacards[n]?.name ?? humanize(n)
      return `${who(ev.operativeId)} changes: ${card(ev.from)} becomes ${card(ev.to)}.`
    }
    case 'OperativePickChanged':
      return `${who(ev.operativeId)} is now ${humanize(ev.to.toLowerCase())}${ev.from ? ` (was ${humanize(ev.from.toLowerCase())})` : ''}.`
    case 'PoolChanged': {
      if (ev.delta === 0) return null
      const name = poolLabel(ev.kind)
      const side = ev.seat ? SEAT_NAME[ev.seat] : 'A seat'
      return ev.delta > 0 ? `${side} gains ${ev.delta} ${name} (${humanize(ev.reason)}), now ${ev.value}.` : `${side} spends ${-ev.delta} ${name} (${humanize(ev.reason)}), ${ev.value} left.`
    }
    case 'OperativeReturned':
      return `${who(ev.operativeId)} ${ev.kind === 'emerge' || ev.kind === 'land' ? setAsideWording(state?.players[state.operatives[ev.operativeId]?.seat ?? 'A']?.teamId).returned : ev.kind === 'reanimated' ? 'is reanimated' : 'returns to the killzone'}.`
    case 'ActivationChained':
      return `${who(ev.fromId)} hands the next activation on (${ev.operativeIds.map(who).join(', ')}).`
    case 'ActivationGated':
      return `${who(ev.operativeId)} cannot activate this time (${humanize(ev.by)}).`
    case 'EffectStarted':
    case 'EffectEnded':
    case 'ConfigChanged':
    case 'ShootEnded':
    case 'FightEnded':
    case 'ApSpent':
    case 'ActionResolved':
    case 'DecisionRequested':
    case 'PhaseEnded':
      return null
    default: {
      // Events added by the engine later (shoot/fight/missions): a generic readable line.
      const e = ev as unknown as Record<string, unknown>
      const bits = Object.entries(e)
        .filter(([k, v]) => !['type', 'seq', 'turningPoint', 'phase', 'seat'].includes(k) && (typeof v === 'string' || typeof v === 'number'))
        .map(([k, v]) => `${humanize(k)} ${typeof v === 'string' && state?.operatives[v] ? opName(state, v) : String(v)}`)
      return `${humanize(String(e.type))}${bits.length ? `: ${bits.join(', ')}` : ''}`
    }
  }
}
