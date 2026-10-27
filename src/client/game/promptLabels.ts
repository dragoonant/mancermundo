// What each decision kind means to a player: a title, how to answer, and why it matters. The title and the one-line help of
// the kinds S5a covers live in labels.ts (`decisionTitle`, `decisionHelp`); this file adds the "why it matters" line and the
// help of the shoot, fight, nerve and end-phase kinds, with wording of our own. A kind the engine adds later has no entry and
// the prompt shows its generic title only.
import type { GameState, PendingDecision } from '@/engine'
import { decisionHelp as baseHelp, decisionTitle } from './labels'

export interface DecisionInfo {
  title: string
  hint: string
  why: string
}

const INFO: Record<string, { hint: string; why: string }> = {
  'setup.role': { hint: 'The roll-off winner picks. Going first means choosing your half and deploying first.', why: 'The gang that sets up second sees where the other gang stands before placing its own fighters.' },
  'setup.zone': { hint: 'Each half of the board is a deployment strip. The other gang takes the other half.', why: 'The half you pick decides which doors and corridors you start beside.' },
  'setup.crew': { hint: 'Pick the fighters who take the field. Fighters you leave out stay in reserve for the whole battle.', why: 'Only the fighters you take can score, and each one you lose counts toward the Bottle test.' },
  'setup.deploy': { hint: 'Pick a fighter, then click inside your highlighted zone. Q and E turn the facing.', why: 'A fighter sees only in front of it, so its starting facing decides what it can shoot in round one.' },
  'action.activate': { hint: 'Click a Ready fighter on the board or in the list. Each fighter acts once per round.', why: 'The gang with Priority acts first; once a fighter has acted it cannot respond again this round.' },
  'action.group': { hint: 'Fighters within the group radius can activate together. Add one or stop.', why: 'A group lets the leader move the whole squad forward in one go, but every member must be named first.' },
  'action.choose': { hint: 'Each activation has two actions. Doors beside the fighter can be clicked on the board.', why: 'Actions cost one or both of the two you have. A Double action uses the whole activation.' },
  'action.flee': { hint: 'Once your gang has bottled out, any fighter may walk off the field.', why: 'A fighter that flees counts as a casualty for scoring, but it is no longer at risk of being picked off.' },
  'move.path': { hint: 'Click the board: the fighter takes the shortest legal route, as far as the allowance reaches. Right click or Escape cancels.', why: 'Where a move ends decides cover, facing and who can charge it next.' },
  'shoot.weapon': { hint: 'Pick the weapon and profile to fire. The numbers are the engine\'s own.', why: 'Short and long range, accuracy and traits differ per profile; the wrong one can make a good target a poor shot.' },
  'shoot.target': { hint: 'Click a target in the list or on the board. The closest enemy is free; a farther one needs a Cool test unless it is easier to hit.', why: 'A hit also pins a standing target, whether or not it is hurt. Cover and range change the hit roll.' },
  'shoot.aim': { hint: 'Click the board to place the blast or flame, or pick a suggested aim point.', why: 'Blasts and flames hit friends as readily as enemies, and a blast placed on the floor is harder to land.' },
  'shoot.allocate': { hint: 'Rapid Fire gave extra hits. Choose who takes each one.', why: 'Extra hits can go to enemies within 3 inches of the target that are no harder to hit.' },
  'shoot.firepower': { hint: 'This Rapid Fire weapon may roll fewer Firepower dice than its maximum. All of them is the usual pick.', why: 'More dice mean more hits, but every Ammo symbol is an Ammo test, and two failed tests jam the weapon for the battle.' },
  'fight.weapons': { hint: 'Choose the weapons to fight with. Two weapons give an extra attack die.', why: 'Weapon choice sets the attack dice, Strength, AP and the traits that trigger on a 6.' },
  'fight.split': { hint: 'Divide your attack dice among the enemies you are touching.', why: 'Dice put on one enemy are dice not rolled at another; a weak fighter may be finished with fewer.' },
  'fight.after': { hint: 'Every enemy you were fighting is down. Finish one with a Coup de Grace or move 2 inches.', why: 'A Coup de Grace takes a Seriously Injured enemy out for good; moving gets you out of the next fight.' },
  'fight.followUp': { hint: 'Your blow knocked the enemy back. Step after it to stay in the fight, or hold your ground.', why: 'Following keeps the enemy Engaged (no shooting it, no slipping away); staying put frees you for the rest of the activation.' },
  'end.bottle': { hint: 'Your gang has fighters down. Take the Bottle test, or bottle out now.', why: 'A gang that bottles out cannot recover its nerve, and its fighters start to flee in each End phase.' },
  'end.assist': { hint: 'A Standing fighter within 1 inch of a Seriously Injured friend can help it recover.', why: 'An assisted fighter takes no Flesh Wound from the recovery roll and picks the better of two dice.' },
  'end.recoveryPick': { hint: 'Two Injury dice were rolled with help. Choose the one that applies.', why: 'Only one die is applied, so take the kindest result.' },
  'skill.choice': { hint: 'A skill gives you a choice. Pick one.', why: 'Skills only apply when you say so, and some can be used once per round.' },
  'dice.reroll': { hint: 'You may re-roll. The new result stands even if it is worse.', why: 'A die is re-rolled only once, and the second result is final.' },
  confirm: { hint: 'Check what is on screen, then continue.', why: 'This step has no odds to weigh: it only needs your go-ahead.' },
}

export function decisionInfo(pending: PendingDecision, state: GameState | null): DecisionInfo {
  const known = INFO[pending.kind]
  const base = baseHelp(pending)
  return {
    title: decisionTitle(pending, state),
    hint: known?.hint ?? base,
    why: known?.why ?? '',
  }
}

/** A nerve line for the fighter card and the prompts: who tests what and with which characteristic. */
export function nerveRule(): string {
  return 'Nerve is tested on Cool (2D6), with +1 for each steady friend within 3 inches.'
}
