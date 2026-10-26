# 10 - Core rules specification

Edition: Necromunda Rulebook (2023, "N23") with later FAQ/errata, Underhive (Zone Mortalis) battlefields only, two-player skirmish, no campaign layer. Everything below is our own paraphrase for engineers; it is not rules text. Rule IDs (R-x.y) are referenced by `12-rules-test-checklist.md`. Every ambiguity is logged in `docs/needs-rules-check.md` with the same ID.

Units: inches ("). Dice: D6 unless stated. "Test" and "check" mean the same thing.

Source key (raw copies under `docs/sources/rules/`, gitignored):

- [ND] Necrodamus N23 rules compilation (fan compilation of official text from N17 to N23, last update 2023-10-11), waywardgarage.com, "Necrodamus (N23 Rules).pdf". Page numbers below are the compilation's own pages, not rulebook pages. Its HOUSE RULE and N17-only notes are NOT used.
- [EOG] Esoteric Order of Gamers, Necromunda Underhive rules summary v2 (2017 box, N17), orderofgamers.com. Used to cross-check wording that N23 kept.
- [WC23] Warhammer Community, "The Seven Best Innovations in the New Necromunda Rulebook" (July 2023).
- [YT23] yaktribe.games thread "Collected Errors/Typos in N23 Rulebook" (community list of N23 changes and errors).
- [SB23] Sprues & Brews, "Necromunda New Core Rulebook 2023 Review" (July 2023).
- [GH] Goonhammer, "Hammer of Math: Necromath... da" (injury dice odds).

Source quality: no free official N23 core text exists. [ND] is the most complete text but is a fan compilation; anything resting only on it is marked Fan-source in the rulings log unless [EOG], [WC23] or [YT23] agree.

## 1. Dice and general principles

Source: [ND] p7-8; [EOG] p1 "Basics".

- R-1.1 Dice: D6; D3 = D6 halved rounding up (1-2 = 1, 3-4 = 2, 5-6 = 3); D66 = two D6 read as tens then units. Special dice are D6 faces mapped as follows.
- R-1.2 Firepower dice faces: 1 = one hit plus Ammo symbol; 2-3 = one hit; 4-5 = two hits; 6 = three hits. The hit count matters only for Rapid Fire (R-14.3).
- R-1.3 Scatter dice faces: 1-4 = arrow; 5-6 = "Hit" symbol, which also carries a small arrow. Direction is uniform 0-360 degrees in the engine; the arrow sets direction on all faces.
- R-1.4 Injury dice faces: 1-2 = Flesh Wound; 3-5 = Seriously Injured; 6 = Out of Action (odds 1/3, 1/2, 1/6, matching [GH]).
- R-1.5 Natural roll = the face rolled before modifiers. Hit rolls, wound rolls and save rolls always fail on a natural 1. Wound rolls always succeed on a natural 6.
- R-1.6 Re-rolls: the new result stands even if worse; no die is re-rolled more than once. Dice rolled together as a total (2D6) are re-rolled together; dice rolled separately may be re-rolled singly.
- R-1.7 Roll-off: each player rolls a D6, highest wins, re-roll ties unless a rule says otherwise.
- R-1.8 Halving and other division round up unless stated.
- R-1.9 Distances are measured between the closest points of two bases (or object edges if there is no base). A Prone fighter is measured as if its base were where it would stand. Distances are never measured through walls or closed doors.
  - RULING: "within X inches" proximity checks (nerve, assist, rally, leading by example, group activation) use the shortest path that does not cross a wall or closed door. Weapon range uses the straight line (a shot needs line of sight anyway).
- R-1.10 Once dice are rolled or a declared action is measured, earlier choices are locked.
  - RULING: the tabletop bans pre-measuring. The port lets both the human and the AI see distances before committing (digital convenience); charge distances still include the random D3. Logged as a deliberate deviation for the owner to confirm.

## 2. Fighter characteristics and tests

Source: [ND] p4; [EOG] p1.

- R-2.1 Profile: M (inches), WS, BS, S, T, W, I, A, Ld, Cl, Wil, Int. WS, BS, I, Ld, Cl, Wil and Int are target numbers written as "4+"; M, S, T, W and A are plain numbers.
- R-2.2 Uses: M movement allowance; WS close-combat hit target (also pistols in melee); BS ranged hit target; S wound-roll strength for melee and S-based weapons, grenade range, force-door rolls; T defence against wound rolls; W damage absorbed before Injury dice; I reflex tests (retreat, doors closing, Flash, reaction to Retreat); A base attack dice; Ld command tests; Cl nerve, target priority, fleeing and rally; Wil resisting mental effects (Insanity, Cursed); Int terminals and lock bypass.
- R-2.3 WS, BS and I tests: roll D6, pass if result >= the target number. A result of 1 always fails, before or after modifiers.
- R-2.4 Ld, Cl, Wil and Int tests: roll 2D6, pass if total >= the target number. A total of 2 always fails, before or after modifiers.
- R-2.5 S and T tests: roll D6, pass if result <= the characteristic.
- R-2.6 Modifying a characteristic: a +1 to a plain number adds 1 (T3 becomes T4); a +1 to a target number improves it by 1 (BS 4+ becomes 3+), which the engine applies as +1 to the roll.
- R-2.7 Hard limits (after advancement or injury, not temporary modifiers): M 1"-8", WS/BS/I 2+ to 6+, S/T/W 1-6, A 1-10, Ld/Cl/Wil/Int 3+ to 10+.
- R-2.8 Damage "-" weapons never remove Wounds; any Injury dice they cause are still applied (R-11.9).

## 3. Statuses and conditions

Source: [ND] p9-11, p33; [EOG] p1 "Fighter status", "Conditions".

- R-3.1 Every fighter on the battlefield is either Standing or Prone.
- R-3.2 Standing - Active: upright and not engaged. The default.
- R-3.3 Standing - Engaged: in base contact with an enemy fighter (or across a barricade, R-15.10). Engaged fighters are always Standing, never Pinned. A fighter engaged by a Versatile weapon outside base contact counts as engaged only for that attack (R-14.3 Versatile).
- R-3.4 Prone - Pinned (model laid face up): no facing, no vision arc, does not block line of sight. If an enemy moves into base contact with a Pinned fighter, it immediately stands up for free and becomes Engaged (R-10.2 for its facing penalty). A fighter can never be both Pinned and Engaged.
- R-3.5 Prone - Seriously Injured (face down): cannot attack, cannot be Engaged, does not block line of sight. Enemies may move within 1" of it freely.
- R-3.6 Out of Action: removed from the battlefield for the rest of the battle.
- R-3.7 Conditions are markers a fighter (or a weapon) can carry in any combination. Core conditions for v1: Ready, Broken, Out of Ammo (per weapon), Blind (Flash), Concussion, Blaze, Insane (Cursed only; no v1 source applies it). Others (Gunked, Webbed, Intoxicated, Hidden/Revealed, Starving) are out of scope (R-16).
- R-3.8 Ready: given to every fighter in the Priority phase regardless of status or condition; removed when the fighter activates. A fighter without Ready normally cannot activate again that round.
- R-3.9 Broken: from a failed nerve test. A Broken fighter may only perform Running for Cover (R-12.4); if Engaged it may only make reaction attacks, at -2 to hit. Removed by a successful Rally test (R-13.8).
- R-3.10 Out of Ammo: the weapon (all of its profiles) cannot be used until a successful Reload (R-8.11).
- R-3.11 Blind (Flash trait, R-14.3): the fighter loses Ready, or if already activated does not become Ready next round; until its next activation it can make no attacks except reaction attacks, which hit only on a natural 6.
- R-3.12 Concussion: -2 to the fighter's I (cannot go worse than 6+) until the end of the round.
- R-3.13 Blaze (on fire): when a burning fighter activates it takes no normal actions; instead (1) it suffers a S3 AP -1 Damage 1 hit; (2) if Engaged or Seriously Injured it does not move, if Pinned it becomes Active, and an Active fighter then moves 2D6" in a random direction, stopping at walls or closed doors, and may choose to become Pinned at the end; (3) roll D6 with +2 if Pinned and +1 per friendly Active fighter within 1": on 6+ the flames go out; (4) the activation ends. A burning fighter cannot make reaction attacks.
- R-3.14 Insane (on activation roll D6): 1-2 becomes Broken (flees the battlefield if already Broken); 3-4 the opponent controls it for this activation; 5-6 acts normally, then a Wil test removes Insane.

## 4. Visibility and cover (Zone Mortalis 2D)

Source: [ND] p6 ("Zone Mortalis (2D)", "Vision arc", "Cover"); [EOG] p3 "2D (Zone Mortalis) tiles"; [YT23] (line of sight drawn from within the vision arc).

- R-4.1 Vision arc: a 90 degree wedge to the fighter's front, centred on the centre of its base. A Standing fighter may turn to face any direction when it activates (before its first action) and after any move. Prone fighters have no facing and no vision arc.
  - RULING: a target is "within the vision arc" if any part of its base lies inside the 90 degree wedge.
- R-4.2 Line of sight (2D board): fighter A has line of sight to B if at least one straight line from the centre of A's base to any point of B's base crosses no wall and no closed door. Other fighters and obstacles never block 2D line of sight. Shooting, charging targets and Coup de Grace also need the target inside the vision arc (R-4.1).
- R-4.3 Cover check (from the attacker): trace lines from the centre of the attacker's base to every point of the target's base. Ignore friendly fighters in base contact with the attacker and any obstacle within 1" of the attacker. A line is "blocked" if it crosses a wall corner/edge, an obstacle or another fighter's base.
  - No line blocked: in the open (no cover).
  - At least half of the target's base reachable but not all: partial cover.
  - Less than half reachable: full cover.
  - RULING: "half of the base" is computed as the fraction of sampled points along the target base's diameter perpendicular to the line of fire that have an unblocked line; Prone fighters' bases do not block (they never block line of sight).
- R-4.4 A Prone fighter (Pinned or Seriously Injured) that is in partial or full cover cannot be targeted by ranged attacks ("in hiding").

## 5. The round

Source: [ND] p33, p49; [EOG] p1 "Game structure"; [YT23] (bottle and flee timing).

- R-5.1 A battle is a sequence of rounds. Each round has three phases in order: Priority, Action, End.
- R-5.2 Priority phase, step 1: roll off for Priority. On a tie, the player who had Priority last round passes it to the opponent; in round 1 re-roll ties.
- R-5.3 Priority phase, step 2: every fighter on the battlefield becomes Ready, whatever its status or conditions (except Blind, R-3.11).
- R-5.4 Action phase: starting with the Priority player, players alternate. On a turn, the player picks one of their Ready fighters, removes Ready and activates it. A Standing fighter may first turn to face any direction. It then makes up to two actions (R-6).
- R-5.5 Group activation: a fighter with Group Activation (X) may, when activated, also nominate up to X other Ready friendly fighters within 3". Leaders normally have X = 2 and Champions X = 1 (the value comes from the fighter's profile data). All are nominated before anyone acts; each then activates in full, one at a time, in the owner's chosen order. A fighter activated as part of a group cannot start a group activation of its own. Status and conditions (Broken, Seriously Injured, Blaze) do not stop a fighter from leading a group.
- R-5.6 If one player has no Ready fighters left, the other activates all their remaining Ready fighters one after another in any order. A player may activate a fighter and take no actions. The Action phase ends when no Ready fighters remain.
- R-5.7 End phase order: (1) Bottle tests; (2) Fleeing the battlefield; (3) Recovery tests; (4) Rally tests. Then remove end-of-round effects (smoke clouds on 1-4 per R-14.3, Concussion expires). See R-13.
- R-5.8 End of battle: the scenario says when (see `11-scenarios.md`). Default: the battle ends at the end of a round in which at most one gang still has fighters on the battlefield.
  - RULING: a gang whose only remaining fighters are Seriously Injured counts as having no fighters on the battlefield for this check (from the voluntary-flee text, [ND] p49).

## 6. Actions

Source: [ND] p34-36; [EOG] p1-2 "Actions"; [YT23] (free-action restriction, Retreat ordering).

- R-6.1 Action types and cost: Simple = 1 action, may be repeated in one activation; Basic = 1 action, at most once per activation; Double = 2 actions (the whole activation), impossible if only 1 action remains; Free = costs nothing, at most once per activation, and a Free and a Basic action with the same name cannot both be made in one activation.
- R-6.2 Each action is fully resolved before the next is declared.
- R-6.3 Which actions are available depends on status at the moment of declaring:

| Status | Action | Type | Summary |
|---|---|---|---|
| Standing Active | Move | Simple | Move up to M (R-7). Two Moves = running. |
| Standing Active | Charge | Double | Move M + D3", may end in base contact; then a free Fight (R-7.6). |
| Standing Active | Shoot | Basic | One ranged attack (R-8). |
| Standing Active | Aim | Basic | +1 to hit for a later Shoot this activation. |
| Standing Active | Take Cover | Basic | Move up to half M, then become Pinned. |
| Standing Active | Reload | Simple | Ammo test for one Out of Ammo weapon (R-8.11). |
| Standing Active | Coup de Grace | Simple | Not engaged: a Seriously Injured enemy within 1" and in vision arc goes Out of Action. |
| Standing Active | Operate Door | Simple | Open or close an unlocked door within 1" (R-15.6). |
| Standing Active | Access Terminal | Basic | Within 1" of a terminal: Int test at -2; pass = free Operate Door on its door (R-15.7). |
| Standing Active | Force Door | Basic | Within 1" of a locked door: D6 + S >= 9 (+2 per other friendly in base contact with the door) opens it (R-15.7). |
| Standing Active | Crawl Through Ductway | Double | Within 1" of a ductway: placed within 1" of its other end (R-15.9). |
| Standing Active | Fire Through Ductway | Basic | Ranged attack at an enemy within 1" of the other end; hits on 5+ only (R-15.9). |
| Standing Active | Smash Open Loot Casket | Basic | Within 1": D6 + S >= 6 opens it; -1 to the contents roll (R-15.11). |
| Standing Active | Bypass Loot Casket Lock | Basic | Within 1": Int test opens it (R-15.11). |
| Standing Active | Carry Loot Casket / Ammo Cache | Simple | Within 1": a Move carrying it; placed in base contact at the end (R-15.11). |
| Standing Engaged | Fight | Basic | Close combat against engaged enemies (R-10). |
| Standing Engaged | Retreat | Basic | Escape combat (R-7.9). |
| Prone Pinned | Stand Up | Basic | Become Standing Active, choose facing. |
| Prone Pinned | Crawl | Double | Move up to half M. |
| Prone Pinned | Blind Fire | Double | Ranged attack with a 360 degree arc, -2 to hit. |
| Prone Pinned | Reload | Simple | As above. |
| Prone Seriously Injured | Crawl | Double | Move up to half M. |
| Broken (any status) | Running for Cover | Double | Mandatory, the only action allowed (R-12.4). |

- R-6.4 A fighter whose status changes mid-activation uses the action list of its new status for its remaining action (for example Stand Up then Move).
- R-6.5 Engaged fighters cannot Move, Shoot (with any weapon) or Reload; only Fight and Retreat.
  - RULING: Reload while Engaged is disallowed because the Engaged action list does not contain it.

## 7. Movement

Source: [ND] p34-40; [EOG] p2 "Movement".

- R-7.1 A move is up to the allowed distance, along any bending path. Distance used is path length. After moving, a Standing fighter may turn to face any direction. A move is declared before measuring; if it falls short the fighter moves as far as it can toward the intended point.
- R-7.2 Fighters may pass through friendly fighters but may never end overlapping any base. Bases may never overlap walls, closed doors or obstacles at the end of a move.
- R-7.3 The 1" rule: a fighter may not move within 1" of an enemy fighter, except (a) when the enemy is Seriously Injured, (b) during a Charge (R-7.6), (c) during an involuntary move.
- R-7.4 Involuntary moves (Knockback, Blaze, Drag) ignore the 1" rule until fully resolved; then, if neither fighter is Seriously Injured, the moved fighter is shifted by the shortest route until it is 1" from the enemy.
- R-7.5 "Directly towards/away": along the straight line through both base centres; stops on contact with a wall, closed door or impassable terrain.
- R-7.6 Charge (Double, Standing Active only): a move of M + D3". It may enter within 1" of enemies (Standing or Prone) but only if it ends in base contact with at least one of them; if the distance is not enough to reach base contact, it stops 1" away. The fighter does not need line of sight to the target before charging (but see R-10.5 for the penalty). The D3 is rolled after the charge is declared. If it ends Engaged, the fighter immediately makes a free Fight action; if instead it ends within 1" of a Seriously Injured enemy and is not Engaged, it may make a free Coup de Grace instead. With a Versatile weapon it may stop within that weapon's Versatile reach of the target and then must make the free Fight.
  - RULING: the charge path takes the shortest legal route to the declared target; the engine computes the path itself rather than accepting a freehand path.
- R-7.7 Take Cover (Basic): move up to half M, then become Pinned.
- R-7.8 Crawl (Double, Pinned or Seriously Injured): move up to half M; the fighter stays Prone.
- R-7.9 Retreat (Basic, Engaged only): (1) the retreating fighter makes an I test; (2) whether or not it passed, each enemy Engaged with it may make an I test and, on a pass, make reaction attacks against it (R-10.8); (3) if the retreating fighter passed and is still Standing, it moves up to D6" (2D6" if Broken). If it failed, the action ends and it stays Engaged.
  - RULING: the retreat move ignores the 1" rule for the enemies it was engaged with only while leaving them, and must end more than 1" from every enemy; if no such end point is within the rolled distance it moves as far away as possible along a straight line directly away from the nearest engaging enemy.
- R-7.10 Difficult terrain: each 1" moved costs 2". Dangerous terrain: as difficult, plus an I test or the fighter goes Out of Action. v1 boards contain neither by default (R-15.13).
- R-7.11 Obstacles (up to 2" tall and 2" across: barricades, barrels, pipes): crossing one costs extra movement equal to its height; a fighter may not end on top of one.
  - RULING: on the flat 2D board every obstacle has a nominal height of 1", so crossing costs 1" extra.
- R-7.12 Falling, climbing, jumping down and leaping gaps do not occur on the v1 flat Zone Mortalis board ("tunnel warfare": walls cannot be climbed, R-15.2). Pinning near an edge is therefore never tested.

## 8. Shooting

Source: [ND] p43-44; [EOG] p2 "Shooting"; [WC23] (blast at a point -2); [YT23].

- R-8.1 Shoot (Basic, Standing Active) sequence: (1) declare weapon and target; (2) check range; (3) hit roll; (4) pinning; (5) resolve hits (R-11).
- R-8.2 Declare: choose one ranged weapon (and profile if it has several) and an eligible target: an enemy within the vision arc and line of sight, not "in hiding" (R-4.4). Engaged enemies are eligible.
- R-8.3 Target priority: the target must normally be the closest eligible enemy. Exceptions without a test: the shooter may ignore a closer enemy that is Seriously Injured, and may choose a farther enemy that is easier to hit than the closest one. Otherwise, to pick a farther target the shooter must first pass a Cool test.
  - RULING: "easier to hit" means the farther target's final hit target number (after all modifiers) is strictly better. If the Cool test fails the fighter must shoot the closest eligible enemy with the same weapon; the action is not lost.
- R-8.4 Range: each weapon has Short and Long range. Within Short range use the Short accuracy modifier; beyond Short up to Long use the Long modifier. Beyond Long range the attack misses automatically, but the Firepower dice is still rolled (R-8.9). A weapon with no Short range always uses Long.
- R-8.5 Hit roll: D6 against the shooter's BS with these modifiers: target in partial cover -1; full cover -2; weapon accuracy at that range +/-n; target Standing and Engaged -1; target Prone and at Long range -1; Aim +1; Blast aimed at a point on the ground -2 (not Smoke); Blind Fire -2; two sidearms fired together -1 each.
- R-8.6 Improbable shot: if modifiers make a hit impossible (needs 7+), roll a D6: only on a 6 roll again, and that second roll hits on the unmodified BS.
- R-8.7 Pinning: a Standing Active fighter hit by a ranged attack becomes Pinned immediately, before wounds are rolled, even if no wound follows. Engaged fighters are never Pinned. (Gas does not pin, R-14.3.)
- R-8.8 Stray shots: if a ranged attack misses, every other fighter (friend or enemy) that is Engaged with the target or within 1" of the line along which range was measured is at risk. Starting with the at-risk fighter closest to the shooter, roll a D6 each: 1-3 that fighter is hit instead (and the sequence stops for that hit); 4-6 move on. If the attack would have scored several hits, run this per hit.
  - RULING: on a miss with a Rapid Fire weapon, the number of stray "hits" to check equals the bullet holes on the Firepower dice rolled for that attack.
- R-8.9 Firepower dice: roll one whenever a weapon with an Ammo value attacks (ranged, or a sidearm in close combat), even if no hit roll is made. If the Ammo symbol shows, make an Ammo test: D6 >= the weapon's Ammo value passes. On a fail the weapon becomes Out of Ammo after the current attack is resolved; a weapon with several profiles has all profiles Out of Ammo. Weapons with Ammo "-" never roll it.
- R-8.10 Twin guns: a fighter with two Sidearm weapons may fire both in one Shoot action at the same target, -1 to hit each, each with its own hit and Firepower roll.
- R-8.11 Reload (Simple): pick an Out of Ammo weapon and make an Ammo test; on a pass it is usable again. Plentiful weapons pass automatically; Scarce and Single Shot weapons can never be reloaded.
- R-8.12 Blind Fire (Double, Pinned): as Shoot but the vision arc counts as 360 degrees and -2 to hit. Target priority still applies.
  - RULING: the 360 degree arc does not change target priority; the closest eligible enemy in any direction is the default target.

## 9. Blasts, templates and scatter

Source: [ND] p44, p61; [EOG] p2 "Other shooting rules"; [WC23].

- R-9.1 Blast (3") uses a 3" diameter marker; Blast (5") a 5" marker. The attacker targets either an eligible enemy (normal priority) or a point on the floor within line of sight (-2 to hit, not for Smoke).
- R-9.2 If the chosen centre is beyond Long range, the marker is moved straight back toward the shooter until the centre is in range; the attack goes ahead.
- R-9.3 Roll to hit. On a hit the marker stays. On a miss it scatters D6" in the direction shown (both scatter faces give a direction), stopping if the centre touches a wall, closed door or other impassable feature. After scatter it may be out of range or line of sight. If the centre leaves the battlefield the attack is removed.
- R-9.4 Misfire: if the scatter die shows "Hit" and the D6 shows 1, roll another D6: on 1 centre the marker on the shooter; on 2-6 the shot is a dud and nothing happens.
- R-9.5 Every fighter (friend or enemy) any part of whose base is under the final marker is hit, unless a wall or closed door lies between that fighter and the marker centre. Resolve pinning and hits for each in the shooter's chosen order.
- R-9.6 Template weapons (range "T"): place the narrow end touching the front of the shooter's base, the whole template inside the vision arc. No target priority and no hit roll: every fighter under it is hit automatically, unless a wall or closed door lies between it and the shooter.
  - RULING: template geometry is 8" long, 0.5" wide at the narrow end, widening linearly to a 2.4" wide rounded end. Measure the physical GW template before release.
- R-9.7 Cover against Blasts and Templates gives a save bonus instead of a hit penalty: partial +1, full +2 to the save roll, judged from the marker centre (Blast) or the shooter (Template). The bonus never applies to field armour. A fighter with no save treated as 7+ for this (R-11.6).
- R-9.8 Fire Through Ductway with a Template automatically hits every fighter within 2" of the far end of the ductway (R-15.9).

## 10. Close combat

Source: [ND] p45; [EOG] p2 "Close combat"; [WC23] (charge without sight -1); [YT23] (stand up when charged).

- R-10.1 Fight (Basic, Engaged) sequence: (1) turn to face; (2) pick weapons; (3) count attack dice; (4) declare targets; (5) hit rolls; (6) resolve hits (R-11); (7) reaction attacks; (8) consolidate or Coup de Grace.
- R-10.2 Turn to face: the attacker may turn; if it does, -1 to all its hit rolls this action. A Pinned fighter that stood up because it was charged also takes this -1 on its attacks that activation and on its reaction attacks.
  - RULING: the engine never forces a turn; it turns only if no engaged enemy is inside the current vision arc, and then applies -1.
- R-10.3 Weapons: up to two weapons with Melee or Sidearm, or one Unwieldy melee weapon, or unarmed (attacker's S, AP -, Damage 1). A range "E" weapon only hits enemies in base contact; Versatile extends reach (R-14.3).
- R-10.4 Attack dice: A, +1 if using two weapons (dual wielding), +1 if this Fight comes from a Charge. Split dice as evenly as possible between two weapons (attacker assigns any odd die). A sidearm may take at most one die; the rest go to a melee weapon or unarmed. Sidearms in melee use WS, ignore their accuracy modifiers, and roll Firepower dice.
- R-10.5 Targets: any enemy Engaged with the attacker and inside its vision arc. Dice may be split between targets; roll separately per weapon and per target.
- R-10.6 Hit roll: WS test per die, modifiers: +1 per assist; -1 per interference; -1 if turned to face; -1 if charging a target the attacker did not have line of sight to at the start of the charge; -2 for a Broken fighter's reaction attacks.
- R-10.7 Assist: each other friendly fighter Engaged with the target and not Engaged with any other enemy. Interference: each other enemy Engaged with the attacker and not Engaged with any other friendly fighter.
- R-10.8 Reaction attacks: after the attacker's hits are resolved, each enemy still Standing and Engaged with it may make its own close-combat attacks (steps 1-6, no charge bonus) against the attacker. Reaction attacks are also triggered by Retreat (R-7.9) and Running for Cover from combat.
  - RULING: reaction attacks always target the fighter that attacked or retreated.
- R-10.9 Parry: when attacked in close combat, a fighter with a Parry weapon forces the attacker to re-roll one successful hit (two hits if it has two Parry weapons). Power weapons can only be parried by Power weapons; Entangle hits cannot be parried.
  - RULING: Parry may be used against reaction attacks too (the defender is "attacked in close combat").
- R-10.10 Consolidate or Coup de Grace: if, after the attacks, every enemy the attacker was Engaged with is Seriously Injured or Out of Action, the attacker may either make a free Coup de Grace on a Seriously Injured enemy in base contact, or move up to 2" in any direction (obeying the 1" rule).
- R-10.11 Coup de Grace (Simple, or free as above): the fighter must not be Engaged; choose a Seriously Injured enemy within 1" and inside its vision arc; it goes Out of Action. No extra nerve test is taken for a fighter that becomes Seriously Injured and is then finished off by a free Coup de Grace in the same activation.

## 11. Resolving hits, damage and injuries

Source: [ND] p46-47; [EOG] p2 "Resolve hits"; [WC23] (serious injury causes flesh wound); [YT23]; [SB23].

- R-11.1 Each hit: (1) wound roll; (2) save roll; (3) inflict damage.
- R-11.2 Wound roll (D6, weapon S vs target T): S >= 2xT 2+; S > T 3+; S = T 4+; S < T 5+; S <= T/2 6+. Natural 6 always wounds, natural 1 always fails (R-1.5).
  - RULING: when both "S >= 2xT" and "S <= T/2" style rows could apply (never with positive values) the first matching row from the top wins.
- R-11.3 Save roll: one save per wounding hit (or per hit that causes an Injury dice without a wound roll, such as Toxin or Gas where saves are allowed). Roll D6 and add the weapon's AP (AP -1 makes a 4+ save need 5+). Natural 1 always fails. Only one item may provide the save.
- R-11.4 If AP makes the save impossible (needs 7+ or worse) no roll is made.
- R-11.5 Traits that ignore saves allow none, whatever the modifiers.
- R-11.6 A fighter without armour that gains a save bonus (Blast/Template cover) is treated as having a 7+ save before the bonus.
- R-11.7 Damage: each point of the weapon's Damage removes one Wound. When the fighter reaches 0 Wounds, roll one Injury dice; each further point of Damage from that same hit adds another Injury dice. A fighter already at 0 Wounds rolls one Injury dice per point of Damage suffered.
  - RULING: Wounds are never restored during a battle by core rules; a fighter that took a Flesh Wound at 0 W stays on the battlefield at 0 W.
- R-11.8 Applying Injury dice (all dice from one hit are rolled together; N23 makes them stack):
  - Out of Action (any die): the fighter is removed.
  - Seriously Injured: the first such result makes the fighter Prone and Seriously Injured; every further Seriously Injured result (from the same roll or later, including a fighter already Seriously Injured) instead gives a Flesh Wound.
  - Flesh Wound: -1 T for the rest of the battle. At T 0 the fighter goes Out of Action. A Standing fighter that only suffers Flesh Wounds stays Standing (a ranged hit will already have pinned it).
  - RULING: resolution order within one roll is Out of Action first (if any, ignore the rest), then Seriously Injured, then Flesh Wounds.
- R-11.9 Damage "-" weapons remove no Wounds but apply any Injury dice their trait causes.
- R-11.10 A fighter that becomes Seriously Injured or goes Out of Action triggers nerve tests (R-12.1).
- R-11.11 Melta (short range, or any range if the weapon has no short range): when the target reaches 0 W, all its Injury dice are Out of Action. Sever: every Injury dice from this weapon is Out of Action.
- R-11.12 Lasting injuries, Capture and XP are campaign rules and are not used in v1 (R-16).

## 12. Nerve tests and Broken

Source: [ND] p48, p35; [EOG] p3 "Nerve tests".

- R-12.1 When a fighter becomes Seriously Injured or goes Out of Action, every friendly fighter within 3" of it takes a nerve test, whatever its own status.
- R-12.2 Nerve test: Cool test, +1 for each other friendly fighter within 3" of the tester that is not Broken and not Seriously Injured. Fail = Broken. A fighter already Broken does not test again.
  - RULING: the already-Broken exemption is implied (Broken has no further effect) and saves rolls.
- R-12.3 On becoming Broken a fighter immediately loses Ready (if it had it) and at once makes a Running for Cover action, even if it already activated this round. Each later activation while Broken must also be Running for Cover.
- R-12.4 Running for Cover (Double): a Standing Active fighter moves up to 2D6"; a Prone one (Pinned or Seriously Injured) moves up to half M and stays Prone. It must end, in priority order: (1) more than 3" from every enemy; (2) out of line of sight of every enemy; (3) in partial or full cover; (4) as far from enemies as possible. If Engaged when it must run: make an I test; on a fail the action ends (still Engaged); on a pass each engaged enemy may pass an I test to make reaction attacks, then, if still Standing, it moves up to 2D6".
  - RULING: the engine evaluates candidate end points and picks the best by those four criteria in order; ties are broken by the shortest path.

## 13. End phase

Source: [ND] p49-50; [EOG] p3 "End phase"; [YT23] (bottle includes reinforcements).

- R-13.1 Bottle test: each gang with at least one fighter Seriously Injured or Out of Action tests, the Priority player first. Roll D6 and add the number of the gang's fighters currently Seriously Injured or Out of Action (fled fighters count as Out of Action). If the total is greater than the gang's starting crew size, the gang is bottled for the rest of the battle and never tests again. A gang may also choose to fail automatically.
- R-13.2 Fleeing: in the End phase in which a gang bottles and each later End phase, starting with the Priority player, every fighter of a bottled gang on the battlefield takes a Cool test regardless of status. Failures flee: removed from the battlefield, counting as Out of Action for the scenario.
  - RULING: fleeing tests repeat every End phase while the gang is bottled ([ND] wording "once a gang has bottled out, models may begin to flee").
- R-13.3 Leading by example: if a Leader of a bottled gang passes its flee test, every friendly fighter within 12" automatically passes. If a Champion passes, friendly fighters within 6" that do not themselves have Leading by Example automatically pass. Test the leader and champions first.
  - RULING: test order inside a gang is Leader, then Champions, then everyone else, so auto-passes apply.
- R-13.4 Voluntary flight: once bottled, at the start of any Action phase, any non-Seriously-Injured fighter may leave the battlefield: Active or Pinned leave automatically; Engaged must pass an I test or become Seriously Injured instead.
- R-13.5 Recovery test: each Seriously Injured fighter rolls one Injury dice:
  - Flesh Wound: it suffers a Flesh Wound (R-11.8) and becomes Pinned (it has recovered).
  - Seriously Injured: it stays Seriously Injured and suffers a Flesh Wound, unless it was assisted.
  - Out of Action: it is removed.
- R-13.6 Assistance: one friendly Standing Active fighter within 1" may assist one recovering fighter per End phase: roll one extra Injury dice and choose which one applies; an assisted fighter takes no Flesh Wound from the recovery roll. However many dice are rolled, only one is applied.
  - RULING: an assisted fighter takes no Flesh Wound from its recovery roll whatever the result (it still becomes Pinned on a Flesh Wound result).
- R-13.7 Recovery tests are made only for fighters Seriously Injured at the start of the End phase.
- R-13.8 Rally test: each Broken fighter takes a Cool test, +1 per friendly fighter within 3" that is not Broken and not Seriously Injured. Pass = no longer Broken; fail = still Broken until the next End phase.

## 14. Weapon profiles and traits

Source: [ND] p5, p61-65; [EOG] p6-7 "Weapon traits".

- R-14.1 Weapon profile: Range Short / Long ("E" = engaged only; "T" = template), Accuracy Short / Long, Strength (number, or "S+n"/"S" based on the wielder), AP, Damage ("-" possible), Ammo (target number, or "-"), Traits. Weapon data lives in the gang-data spec, not here.
- R-14.2 Trait names the core rules define (full list): Backstab, Blast (3"/5"), Blaze, Burrowing, Chem Delivery, Combi, Concussion, Cursed, Defoliate, Demolition, Digi, Disarm, Drag, Entangle, Esoteric, Fear, Fixed, Flare, Flash, Gas, Graviton Pulse, Grenade, Gunk, Haemophagic, Hexagrammatic, Impale, Knockback, Lance, Limited, Melee, Melta, Paired, Parry, Phase, Plentiful, Power, Power Pack, Pulverise, Rad-phage, Rapid Fire (X), Reckless, Rending, Scarce, Scattershot, Seismic, Sever, Shield, Shield Breaker, Shock, Shred, Sidearm, Silent, Single Shot, Smoke, Template, Toxin, Unstable, Unwieldy, Versatile, Vortex, Web. Weapon variants: Master-crafted, Twin-linked, Ironhead, Reclaimed/Scavenged.
- R-14.3 Behaviour of the traits v1 is expected to need (gang data may require more; anything not listed here must be specified before use):
  - Backstab: +1 S if the attacker is outside the target's vision arc.
  - Blast (X): R-9.
  - Blaze: a target hit and not taken Out of Action catches fire (Blaze condition, R-3.13) on a 4+.
  - Concussion: target gains Concussion (R-3.12).
  - Disarm: on a natural 6 to hit, the target may only make unarmed reaction attacks for the rest of the round.
  - Entangle: hits cannot be parried; on a natural 6 to hit, the target's reaction attacks are at -2.
  - Flash: no wound roll; the target makes an I test or becomes Blind (R-3.11).
  - Gas: no wound roll; roll D6, success if >= target's T (natural 6 always succeeds) to cause an Injury dice without touching Wounds; no save allowed; the target is not pinned by the hit.
  - Grenade: thrown with a Shoot action; no Short range; Long range = the wielder's S times the multiplier in the weapon data; no Firepower dice, instead an Ammo test after every use; cannot be reloaded.
  - Knockback: if the hit roll is >= the target's S, push it 1" directly away; if it cannot move the full 1", +1 Damage. In melee the attacker may follow up to stay in base contact (not across a barricade). For Blasts roll per fighter and push away from the centre (scatter die if the centre is over the base centre).
  - Limited: when this ammo runs out it is lost for the battle (other profiles still reload).
  - Melee: usable in close combat. Melta and Sever: R-11.11.
  - Paired: counts as dual weapons; when charging the base A is doubled.
  - Parry: R-10.9.
  - Plentiful: reload Ammo tests pass automatically.
  - Power: cannot be parried except by Power; a natural 6 to hit ignores saves (except field armour) and adds +1 Damage.
  - Pulverise: after an Injury dice is rolled, roll D6; if >= target's T or a natural 6, one Flesh Wound result becomes Seriously Injured.
  - Rapid Fire (X): after one successful hit roll, roll up to X Firepower dice; total hits = total bullet holes. The first hit must go to the original target; extra hits may go to other eligible enemies within 3" of it that are in range and line of sight and not harder to hit. Allocate all hits before wound rolls. An Ammo test for each Ammo symbol: one failure = Out of Ammo; two or more = jammed, unusable for the battle.
  - Rending: a natural 6 to wound adds +1 Damage.
  - Scarce: cannot be reloaded.
  - Scattershot: a hit makes D6 wound rolls instead of one.
  - Shock: a natural 6 to hit wounds automatically.
  - Shred: a natural 6 to wound doubles AP.
  - Sidearm: usable in close combat (one attack die per sidearm, R-10.4) and twin-fired (R-8.10).
  - Silent: only matters for Sneak Attack and Pitch Black (out of scope).
  - Single Shot: one use per battle; counts as a failed Ammo test after use; no Firepower dice unless also Rapid Fire.
  - Smoke: no hit, wound or pin; place a cloud marker 2.5" radius around the point; it blocks line of sight into, out of and through it, does not block movement; in each End phase remove it on 1-4 (D6). No -2 for targeting a point.
  - Template: R-9.6.
  - Toxin: no wound roll; D6 >= target's T (natural 6 always succeeds) causes an Injury dice without touching Wounds; saves are allowed.
  - Unstable: when the Ammo symbol is rolled, roll D6: on 1-3 the shooter goes Out of Action (the attack still resolves).
  - Unwieldy: uses two weapon slots; a Shoot with it is a Double action; in melee it cannot be paired with another weapon.
  - Versatile: may Engage and attack in melee at up to the weapon's Long range during this fighter's activation and its reaction attacks; the target counts as Engaged only for that attack and can only strike back if it also has Versatile reach. Only fighters in base contact give assists.
  - Note: the End phase list ("removed on 1-4") and the trait text ("roll 5+ or remove") say the same thing.
- R-14.4 Armour: one standard armour item gives the save (for example Flak 6+, Mesh 5+, Carapace 4+ per gang data). Combined/extra armour and field armour exist; the gang-data spec says which items v1 uses.

## 15. Zone Mortalis battlefield

Source: [ND] p6, p12, p15-16, p34-35, p287, p294; [EOG] p3 "2D (Zone Mortalis) tiles"; [YT23] (N23 setup minimums); woehammer.com and the GW product listing (12" tiles).

- R-15.1 Board: square Zone Mortalis floor tiles, 12" x 12". v1 boards are 2x3 tiles (24" x 36") unless a scenario says otherwise. Each tile shares at least half of one edge with another tile.
- R-15.2 Flat "tunnel warfare": walls are as tall as the ceiling, cannot be climbed, and there are no upper levels, ladders or stairs. Falling never happens (R-7.12).
- R-15.3 Walls are impassable and solid: no movement, line of sight or measuring through them. The battlefield edge acts as a wall.
- R-15.4 Fighters and obstacles do not block line of sight on a 2D board but do give cover (R-4.3).
- R-15.5 Doors: every door starts closed. A closed door is impassable and blocks line of sight like a wall. An open door is a gap in the wall.
- R-15.6 Operate Door (Simple): open a closed unlocked door, or close an open door, within 1". If a closing door would hit a fighter standing in the doorway, that fighter makes an I test: pass = it moves up to 2" to clear the doorway (not within 1" of an enemy); fail or not enough room = it suffers a S3 Damage 2 hit (saves allowed) and, if it survives, is moved the shortest distance clear of the doorway (random side if exactly centred; within 1" of an enemy only if there is no alternative).
- R-15.7 Locked doors have a terminal on each side within 1". They cannot be operated normally (except by a scenario defender, who holds the codes). To open one: Access Terminal (Basic, within 1" of a terminal): Int test at -2, pass = free Operate Door on that door from any distance; or Force Door (Basic, within 1" of the door): D6 + S >= 9, +2 for each other friendly fighter in base contact with the door. Once opened it stays unlocked for the battle.
- R-15.8 Attacking doors: a closed door can be attacked by ranged or melee attacks and is hit automatically. Doors are T5 with 4 W and no save; at 0 W the door is removed (permanently open).
  - RULING: attacks at a door use the normal wound table and Damage; no Injury dice; target priority does not apply when the door is the declared target.
- R-15.9 Ductways: a short duct (up to 2") through a wall. Crawl Through Ductway (Double): within 1" of one end, placed within 1" of the other end, not within 1" of an enemy and not overlapping anything; if no legal spot, the action cannot be taken. Fire Through Ductway (Basic): within 1" of one end, shoot an enemy within 1" of the other end; hits on 5+ regardless of BS and modifiers; templates hit everything within 2" of the far end; a Blast targets a fighter or point within 1" of the far end, hits on 5+, and scatters normally on a miss.
- R-15.10 Barricades (obstacles): two fighters on opposite sides, both in base contact with the barricade and within 1" of each other, are Engaged with each other. A charge may end that way.
- R-15.11 Loot caskets: Smash Open (Basic) D6 + S >= 6, then -1 on the contents roll; Bypass Lock (Basic) Int test; Carry (Simple) moves it with the fighter. Contents (D6): 1 booby trapped (becomes a frag trap); 2-3 nothing useful; 4-6 becomes an ammo cache. Ammo cache: fighters within 1" get +2 to Ammo tests and ignore Scarce; a natural 6 on that test exhausts the cache. Scenarios may replace the contents table.
  - RULING: the frag trap result is replaced by an immediate explosion using the frag grenade profile (S3, AP -, Damage 1, Blast 3", Knockback) centred on the casket, no hit roll, because booby traps are not in v1 data.
- R-15.12 Setup procedure (N23 Underhive default): alternate placing pieces, the defender (or roll-off winner) first; (1) tiles; (2) obstacles and small terrain; (3) loot caskets. N23 minimums for Zone Mortalis: at least 3 doors, D6 barricades, 2 ductways, 2 loot caskets, caskets at least 6" from any board edge. v1 ships hand-authored boards that already satisfy these, so setup is a board choice, not a placement mini-game.
- R-15.13 Optional Zone Mortalis features (service hatches, lifts, pitfalls, sludge, vents, gang relics, Pitch Black, Badzone environments) are out of scope for v1 (R-16).

## 16. Out of scope for v1

Source: owner scope decision; [ND] p227-300 for what exists.

- R-16.1 Not implemented: campaigns, XP, lasting injuries, capture, credits after battle, Tactics cards, Hired Guns, Hangers-on, Brutes, vehicles, mounts, exotic beasts, psykers and Wyrd powers, chems, skills not listed in the gang-data spec, Pitch Black/Visibility, Sneak Attack and Reinforcements, multi-player, Badzone environments, falling and multi-level terrain, booby traps, special Zone Mortalis terrain.
- R-16.2 Any of these appearing in gang data must be raised as a ruling before implementation, not improvised.
