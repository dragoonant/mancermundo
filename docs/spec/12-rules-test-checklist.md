# 12 - Rules test checklist

Engine tests are named by these IDs (for example `it('SHOOT-004 ...')`). Format: `ID | rule ref | expected behaviour`. Rule refs: R-x.y = `10-rules-core.md`, M-x.y = `11-scenarios.md`. Every test pins its dice with a forced stream unless it checks pure legality. IDs are stable: never renumber; retire an item by marking it `RETIRED`.

## DICE - dice and general principles

DICE-001 | R-1.1 | D3 maps D6 faces 1-2/3-4/5-6 to 1/2/3.
DICE-002 | R-1.2 | Firepower die faces map to hits 1,1,1,2,2,3 and only face 1 shows the Ammo symbol.
DICE-003 | R-1.4 | Injury die faces 1-2 Flesh Wound, 3-5 Seriously Injured, 6 Out of Action.
DICE-004 | R-1.5 | A natural 1 fails a hit roll needing 2+ even with +2 modifiers; a natural 6 wounds even when the table needs 7+ after modifiers.
DICE-005 | R-1.9 | Proximity "within 3"" uses path distance: a fighter 2" away through a wall but 9" around it is not within 3".

## TEST - characteristic tests

TEST-001 | R-2.3 | BS 4+ test passes on 4, fails on 3; a modified 1 always fails.
TEST-002 | R-2.4 | Cl 7+ test passes on 2D6 = 7; a total of 2 fails even with +6.
TEST-003 | R-2.7 | Flesh Wounds lowering T below 1 trigger Out of Action rather than clamping at 1.

## STATUS - statuses and conditions

STATUS-001 | R-3.3 | Two enemy fighters in base contact are both Engaged; an Engaged fighter cannot be Pinned by a ranged hit.
STATUS-002 | R-3.4 | A Pinned fighter contacted by a charging enemy becomes Standing Engaged without spending an action.
STATUS-003 | R-3.5 | An enemy may move within 1" of and into contact with a Seriously Injured fighter without charging; it never becomes Engaged.
STATUS-004 | R-3.8 | Ready is given to every fighter in the Priority phase, including Seriously Injured and Broken fighters.
STATUS-005 | R-3.11 | A Blind fighter that already activated is not readied next round; its reaction attacks hit only on natural 6.
STATUS-006 | R-3.13 | A burning Active fighter takes the S3 hit, moves 2D6" randomly, rolls 6+ (with +2 if Pinned) to extinguish, and takes no other actions.

## VIS - vision arc, line of sight, cover

VIS-001 | R-4.1 | A target whose base is entirely outside the 90 degree front arc cannot be shot; one with any part of its base inside can.
VIS-002 | R-4.2 | A line from base centre to the target base that crosses a closed door gives no line of sight; opening the door restores it.
VIS-003 | R-4.3 | A target with every traced line clear is in the open; with half or more clear is partial cover; with less than half clear is full cover.
VIS-004 | R-4.3 | An obstacle within 1" of the shooter and a friendly fighter in base contact with the shooter are ignored for cover.
VIS-005 | R-4.4 | A Pinned fighter in partial cover cannot be targeted by a ranged attack; the same fighter in the open can.

## ROUND - round structure and activation

ROUND-001 | R-5.2 | Round 1 priority ties re-roll; a later tie hands priority to the player who did not hold it last round.
ROUND-002 | R-5.4 | Activations alternate starting with the Priority player; a fighter without Ready cannot be activated.
ROUND-003 | R-5.5 | A Leader may group-activate at most 2 Ready friends within 3"; a Champion at most 1; a fighter 3.1" away is rejected.
ROUND-004 | R-5.5 | All group members are nominated before any acts; each finishes its whole activation before the next starts.
ROUND-005 | R-5.6 | When one side has no Ready fighters, the other activates all its remaining Ready fighters in a row.
ROUND-006 | R-5.7 | End phase steps run in the order Bottle, Flee, Recovery, Rally.
ROUND-007 | R-5.8 | The battle ends at the end of a round when only one gang has non-Seriously-Injured fighters on the board.

## ACT - actions

ACT-001 | R-6.1 | Move can be performed twice in one activation; Shoot cannot.
ACT-002 | R-6.1 | A Double action is rejected when only one action remains.
ACT-003 | R-6.1 | A free Fight after a Charge plus a Basic Fight in the same activation is rejected.
ACT-004 | R-6.3 | Take Cover moves at most half M and leaves the fighter Pinned.
ACT-005 | R-6.3 | A Seriously Injured fighter's only legal action is Crawl (Double, half M).
ACT-006 | R-6.5 | An Engaged fighter may not Move, Shoot or Reload; Fight and Retreat are offered.
ACT-007 | R-10.11 | Coup de Grace takes a Seriously Injured enemy within 1" and in arc Out of Action; it is rejected while the actor is Engaged.

## MOVE - movement

MOVE-001 | R-7.1 | A move path longer than M is rejected; path length is measured along the bends.
MOVE-002 | R-7.3 | A Move ending 0.9" from a Standing enemy is rejected; the same move ending 0.9" from a Seriously Injured enemy is allowed.
MOVE-003 | R-7.4 | Knockback into contact with an enemy is resolved and then the pushed fighter is moved back to 1" separation.
MOVE-004 | R-7.6 | A Charge moves up to M + D3"; with the D3 short of contact the charger stops exactly 1" away.
MOVE-005 | R-7.6 | A successful Charge grants a free Fight with +1 attack die.
MOVE-006 | R-7.6 | A Charge ending within 1" of a Seriously Injured enemy and not Engaged may take a free Coup de Grace instead.
MOVE-007 | R-7.9 | Retreat: engaged enemies get their I tests for reaction attacks whether or not the retreater passed its own I test.
MOVE-008 | R-7.9 | A failed Retreat I test leaves the fighter Engaged and ends the action; a pass moves up to D6" (2D6" if Broken) ending more than 1" from enemies.

## SHOOT - shooting

SHOOT-001 | R-8.2 | An Engaged enemy is an eligible ranged target; a Prone enemy in cover is not.
SHOOT-002 | R-8.3 | The closest eligible enemy is the default target; a farther target requires a Cool test unless it is easier to hit.
SHOOT-003 | R-8.3 | A closer Seriously Injured enemy may be ignored without a Cool test.
SHOOT-004 | R-8.3 | A failed target-priority Cool test redirects the shot to the closest enemy instead of cancelling it.
SHOOT-005 | R-8.4 | A target at exactly Short range uses the Short accuracy; just beyond uses Long; beyond Long auto-misses but still rolls the Firepower die.
SHOOT-006 | R-8.5 | Modifiers stack: full cover -2, target Engaged -1, Long-range Prone -1, Aim +1 give a net -3.
SHOOT-007 | R-8.6 | An improbable shot needs a 6 then a second roll against unmodified BS.
SHOOT-008 | R-8.7 | A Standing Active target hit by a ranged attack is Pinned before the wound roll, even if the wound roll fails.
SHOOT-009 | R-8.8 | A miss rolls stray shots for fighters within 1" of the line, closest to the shooter first; 1-3 hits that fighter and stops the check.
SHOOT-010 | R-8.9 | An Ammo symbol with a failed Ammo test marks the weapon Out of Ammo after the attack resolves; all its profiles become unusable.
SHOOT-011 | R-8.11 | Reload of a Plentiful weapon always succeeds; a Scarce weapon cannot be reloaded.

## BLAST - blasts and templates

BLAST-001 | R-9.1 | Targeting a floor point with a Blast applies -2 to hit; a Smoke blast does not.
BLAST-002 | R-9.3 | A missed blast scatters D6" in the scatter direction and stops where its centre meets a wall.
BLAST-003 | R-9.4 | Scatter "Hit" plus a 1: a further 1 centres the blast on the shooter; 2-6 is a dud.
BLAST-004 | R-9.5 | Every fighter under the marker is hit except those with a wall between them and the centre; friends are hit too.
BLAST-005 | R-9.6 | A template hits every fighter under it with no hit roll and ignores target priority; fighters behind a wall are not hit.
BLAST-006 | R-9.7 | A target in partial cover from the blast centre gets +1 to its save; an unarmoured target saves on 6 (7+ improved by 1).

## CC - close combat

CC-001 | R-10.2 | Turning to face before attacking applies -1 to all of that fighter's hit rolls.
CC-002 | R-10.2 | A Pinned fighter stood up by a charge takes -1 on its reaction attacks.
CC-003 | R-10.4 | A sidearm in melee takes only one die, uses WS, ignores accuracy and rolls a Firepower die.
CC-004 | R-10.6 | Charging a target not visible at the start of the charge applies -1 to hit.
CC-005 | R-10.7 | Each friend engaged only with the target gives +1; each extra enemy engaged only with the attacker gives -1.
CC-006 | R-10.8 | Engaged enemies still Standing make reaction attacks after the attacker resolves hits; Seriously Injured ones do not.
CC-007 | R-10.8 | A Broken fighter's reaction attacks are at -2.
CC-008 | R-10.9 | Parry forces one successful hit to be re-rolled; a Power weapon attack is not parried by a non-Power Parry weapon.
CC-009 | R-10.10 | If all engaged enemies are down, the attacker may consolidate up to 2" or take a free Coup de Grace, not both.

## INJ - wounds, saves, injuries

INJ-001 | R-11.2 | Wound table: S6 vs T3 2+, S4 vs T3 3+, S3 vs T3 4+, S3 vs T4 5+, S2 vs T4 6+.
INJ-002 | R-11.3 | AP -1 turns a 4+ save into 5+; a natural 1 save always fails.
INJ-003 | R-11.7 | Damage 2 on a 1-W fighter removes the wound and rolls 2 Injury dice.
INJ-004 | R-11.7 | A fighter at 0 W (after a Flesh Wound) hit for Damage 1 rolls 1 Injury die.
INJ-005 | R-11.8 | Two Seriously Injured results from one roll: the fighter is Seriously Injured and takes one Flesh Wound.
INJ-006 | R-11.8 | Any Out of Action result in a roll removes the fighter; other dice in that roll are ignored.
INJ-007 | R-11.8 | A Flesh Wound lowers T by 1; T reaching 0 is Out of Action.
INJ-008 | R-11.8 | A Seriously Injured result on an already Seriously Injured fighter gives a Flesh Wound only.
INJ-009 | R-11.11 | A Melta hit at Short range that reduces the target to 0 W is Out of Action with no Injury roll; at Long range it rolls normally.

## NERVE - nerve tests and Broken

NERVE-001 | R-12.1 | A friend within 3" of a fighter that becomes Seriously Injured takes a nerve test; one 3.5" away does not.
NERVE-002 | R-12.2 | The nerve test gets +1 per other friend within 3" that is not Broken or Seriously Injured.
NERVE-003 | R-12.3 | A fighter that fails a nerve test loses Ready and immediately makes Running for Cover, even if it already activated.
NERVE-004 | R-12.3 | A Broken fighter's only available action on activation is Running for Cover.
NERVE-005 | R-12.4 | Running for Cover picks an end point more than 3" from enemies before one merely out of sight.

## END - end phase

END-001 | R-13.1 | Bottle with starting crew 10: 4 down can never bottle (6 + 4 = 10 is not more than 10); 5 down bottles on a 6 but not on a 5.
END-002 | R-13.1 | A bottled gang never tests again; the player may choose to fail voluntarily.
END-003 | R-13.2 | Every fighter of a bottled gang takes a Cool test each End phase; failures are removed and count as Out of Action.
END-004 | R-13.3 | A Leader passing its flee test auto-passes friends within 12"; a Champion passing auto-passes friends within 6" that lack Leading by Example.
END-005 | R-13.5 | Recovery roll Flesh Wound: an unassisted fighter takes a Flesh Wound and becomes Pinned; an assisted one becomes Pinned with no Flesh Wound.
END-006 | R-13.5 | Recovery roll Seriously Injured unassisted adds a Flesh Wound; assisted adds none.
END-007 | R-13.6 | An assisting Active friend within 1" adds one Injury die and the owner picks the result; one fighter may assist only one recovery per End phase.
END-008 | R-13.7 | A fighter that became Seriously Injured during this round's Action phase makes a recovery test this End phase; one Out of Action does not.
END-009 | R-13.8 | Rally: Broken fighter passes a Cool test with +1 per friend within 3" not Broken or Seriously Injured and loses Broken.
END-010 | R-13.4 | A bottled gang is asked at the start of each Action phase which fighters leave; Active and Pinned fighters go at once, an Engaged one passes an Initiative test or is left Seriously Injured.
END-011 | R-13.5, R-12.3 | Nerve tests caused by a recovery roll (an Out of Action result) are taken in the End phase; a friend that breaks runs for cover before the Rally tests.

## TRAIT - weapon traits

TRAIT-001 | R-14.3 | Rapid Fire (2) on a hit rolls up to 2 Firepower dice and scores hits equal to total bullet holes.
TRAIT-002 | R-14.3 | Rapid Fire extra hits may go only to enemies within 3" of the original target that are not harder to hit.
TRAIT-003 | R-14.3 | Rapid Fire with two failed Ammo tests jams the weapon for the battle (Reload rejected).
TRAIT-004 | R-14.3 | Knockback with a hit roll >= target S pushes 1"; blocked by a wall adds +1 Damage.
TRAIT-005 | R-14.3 | Gas: no save, no pinning, injury on D6 >= T; Toxin: same test but saves allowed.
TRAIT-006 | R-14.3 | Power: a natural 6 to hit ignores the armour save and adds +1 Damage.
TRAIT-007 | R-14.3 | Shock: a natural 6 to hit wounds without a wound roll.
TRAIT-008 | R-14.3 | Unwieldy: Shoot with it costs both actions; in melee no second weapon is allowed.
TRAIT-009 | R-14.3 | Versatile: a charger may stop at Versatile reach and fight; the target cannot react unless it also has Versatile reach.
TRAIT-010 | R-14.3 | Blaze: a hit target not taken Out of Action catches fire on 4+.
TRAIT-011 | R-14.3 | Smoke cloud blocks line of sight through it and is removed in the End phase on 1-4.

## ZM - Zone Mortalis board

ZM-001 | R-15.1 | Board loader rejects a tile that shares less than half an edge with every other tile.
ZM-002 | R-15.3 | Movement paths and range measurements never pass through walls or board edges.
ZM-003 | R-15.5 | All doors start closed; a closed door blocks movement and line of sight.
ZM-004 | R-15.6 | Closing a door on a fighter in the doorway: I pass moves it up to 2" clear; I fail gives a S3 D2 hit and then moves it clear.
ZM-005 | R-15.7 | A locked door rejects Operate Door from a non-defender; Access Terminal passes on Int test at -2 and opens it from range.
ZM-006 | R-15.7 | Force Door opens on D6 + S >= 9, with +2 per other friend in base contact with the door.
ZM-007 | R-15.8 | Shooting a closed door auto-hits; at 0 of 4 W (T5) it is removed and its gap is open.
ZM-008 | R-15.9 | Crawl Through Ductway places the fighter within 1" of the far end and is refused if every spot is within 1" of an enemy.
ZM-009 | R-15.9 | Fire Through Ductway hits on 5+ regardless of BS; a template version hits all within 2" of the far end.
ZM-010 | R-15.10 | Two enemies touching opposite sides of a barricade and within 1" of each other are Engaged.
ZM-011 | R-15.11 | Smash Open succeeds on D6 + S >= 6 and applies -1 to the contents roll (minimum 1).
ZM-012 | R-15.12 | Every shipped board has at least 3 doors, 2 ductways, 2 loot caskets 6"+ from edges.

## SCEN - scenarios

SCEN-001 | M-1.6 | Standard deployment rejects any fighter closer than 12" to the dividing line.
SCEN-002 | M-2.4 | Tunnel Skirmish scores 3/2/1 for Leader/Champion/other Out of Action or fled; Seriously Injured scores nothing.
SCEN-003 | M-3.6 | In Smash & Grab the defender cannot open a casket; the attacker opening a third casket locks an attacker win.
SCEN-004 | M-3.7 | A Smash & Grab casket roll of 1 resolves a 5" S4 blast centred on it and still counts as opened.
SCEN-005 | M-4.2 | Forgotten Riches crew cap follows the 2D6 table (7 on a roll of 6-8).
SCEN-006 | M-4.5 | Horrors in the Dark triggers only for a fighter activating more than 8" from every other fighter; a 1 that leaves it Seriously Injured removes it.
SCEN-007 | M-4.7 | Forgotten Riches counts a casket only if it ends on the owner's deployment tile within 3" of the board edge.
SCEN-008 | M-1.10 | A gang that voluntarily bottles and flees loses Smash & Grab and Forgotten Riches outright.
SCEN-009 | M-4.3, M-4.4 | Forgotten Riches starts: five caskets one per tile with the first in the centre, casket-free outer tiles are the deployment choices, fighters set up within 3" of the tile's outer edge.
SCEN-010 | M-4.4 | When the two deployment tiles touch no fighter is set up within 6" of an enemy.
SCEN-011 | M-3.4 | Smash & Grab: the defender places 5 caskets in its own half, 4" from every edge, 6" apart and clear of walls, after choosing its half and before deployment.

## GOLDEN

GOLDEN-001 | R-5 to R-13 | One forced-dice round of the Goliath and Escher starter gangs (charges, shots, fights, nerve, the End phase) reproduces its pinned digest.

## SKC - close combat skills and skill actions

SKC-001 | 13-gangs 7.3 (Crushing Blow) | One non-Sidearm attack is nominated before the hit rolls; if it hits it gets +1 Strength and +1 Damage (the nomination is automatic; each fight and each reaction nominates its own).
SKC-002 | 13-gangs 7.3 (Crushing Blow) | A Sidearm attack is never the nominated one: with a pistol die and an unarmed die, the unarmed die is boosted.
SKC-003 | 13-gangs 7.4 (Counter-attack) | Reaction attacks gain one Attack for each of the opponent's attacks at that fighter that failed to hit (missed, parried or stepped aside); Fight actions gain nothing.
SKC-004 | 13-gangs 7.4 (Disarm) | The fighter's melee weapons disarm on a natural 6 to hit; a weapon that already has Disarm disarms on 5+; below that nothing happens.
SKC-005 | 13-gangs 7.4 (Parry) | The fighter counts as carrying one extra Parry weapon: without a Parry weapon one hit is re-rolled, with two Parry weapons three can be.
SKC-006 | 13-gangs 7.4 (Step Aside) | A fighter hit in close combat passes an Initiative test to avoid the most dangerous hit, once against each enemy per set of attacks (the attempt is automatic); a failed test leaves every hit.
SKC-007 | 13-gangs 7.4 (Combat Master) | The fighter's own attacks ignore interference, and as a friend it counts as giving an assist even when it is Engaged with other enemies.
SKC-008 | 13-gangs 7.7 (Fists of Steel) | Unarmed attacks get +2 Strength and Damage 2.
SKC-009 | 13-gangs 7.8 (Combat Virtuoso) | The listed knives, stiletto weapons, power knives and swords and chainswords gain Versatile with a reach equal to the fighter's Strength (the Fight at reach is offered).
SKC-010 | 13-gangs 7.3 (Bulging Biceps) | An Unwieldy close combat weapon can be paired with a second weapon; without the skill it stands alone. Slots are unchanged.
SKC-011 | 13-gangs 7.5 (Impetuous) | Consolidate offers 4" (move.path allowance 4) instead of 2".
SKC-012 | 13-gangs 7.5 (Fearsome) | A fighter that charges the Fearsome fighter first passes a Willpower test (2D6, before the D3 is rolled); on a fail the Charge is paid and nobody moves.
SKC-013 | 13-gangs 7.3 (Headbutt) | A Free action against an Engaged enemy in base contact (once per activation): 2D6, a die at least the target's Toughness hits at Strength +2, Damage 2; both dice lower and the Headbutter takes a hit at its own Strength, Damage 1. Costs no action.
SKC-014 | 13-gangs 7.3 (Hurl) | A Basic action on an Engaged enemy in base contact or a Seriously Injured enemy within 1": the target passes an Initiative test or is moved D3" in a direction the Hurler chooses (skill.choice listing what each direction touches), then is hit at Strength 3 and Pinned; a passed test leaves it where it is.
SKC-015 | 13-gangs 7.3 (Hurl) | The hurled fighter stops against another fighter; both take a Strength 3 hit and are Pinned.
SKC-016 | 13-gangs 7.3 (Hurl) | After a Charge, Hurl can replace the free Fight (skill.choice fight / hurl:<id>); no Fight and no reaction attacks follow a Hurl.
SKC-017 | 13-gangs 7.6 (Overseer) | A Double action while Active: on a passed Leadership test a friend within 6" activates at once for two actions, Ready or not; its Ready status is as it was afterwards; a failed test orders nobody.
SKC-018 | 13-gangs 7.7 (Immovable Stance) | A Double action: until its next activation the fighter adds 2 to its saves (best 2+, before AP), cannot be Pinned and cannot be shifted by Knockback, Hurl or Unleash the Beast.
SKC-019 | 13-gangs 7.7 (Naaargah!) | After its two actions the fighter may try a third (skill.choice): a Toughness test (D6 at most T) wins one more action; it ends the activation Pinned whether it passed or failed; declining leaves it standing.
SKC-020 | 13-gangs 7.7 (Unleash the Beast) | A Simple action while Engaged: every fighter in base contact, friend or foe, passes a Strength test (D6 at most S) or is pushed D3" straight away; the order is by fighter id.
SKC-021 | 13-gangs 7.8 (Somersault) | A Basic action: the fighter is placed within 6" (straight line) of where it stands, at a spot it can see and more than 1" from every enemy, even out of combat, with no dice and no reaction attacks; passing the move.path cancels the action unspent.
SKC-022 | 13-gangs 7.8 (Acrobatic) | While Active a Move or Charge can pass over enemy bases and obstacles at no extra cost; the 1" rule is checked only where it ends.
SKC-023 | 13-gangs 7.8 (Hit and Run) | After a Charge's free Fight and before the reaction attacks the fighter may make a free Retreat (skill.choice, use first); the enemies that reacted to the Retreat do not react again after the Fight.
SKC-024 | 13-gangs 7.8 (Lightning Reflexes) | Once each round an Engaged fighter about to be attacked by an enemy's Fight may make a free Retreat first (skill.choice, use first); the use is spent whether or not the Retreat works.
SKC-025 | 13-gangs 7.6 (Regroup) | A fighter still Active when its activation ends passes a Leadership test (automatic) to rally every Broken friend within 6"; an Engaged fighter takes no test.
SKC-026 | 13-gangs 7.6 (Commanding Presence) | Group Activation +1: the leader may nominate one more fighter.
SKC-027 | code hooks | The 23 code hooks of these skills are registered with a params validator that accepts the data's params and refuses a non-number.
SKC-028 | code hooks | The shipped data validates with every one of these code hooks registered.
SKC-029 | skills in play | Random-bot games in which every fighter has every one of these skills end cleanly with no violation or rejection, and the skill actions and hooks fire.
