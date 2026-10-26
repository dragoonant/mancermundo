# 10 - Core rules specification

Mancermundo ports Kill Team (2024 edition, inches) 1:1. This file restates the mechanics in our own words. Every rule has an ID `R-<section>.<n>` that tests and code comments cite. `RULING:` lines mark places where the sources disagree, are silent, or need an engine-level abstraction; each is mirrored in `docs/needs-rules-check.md`.

Authority order: Wahapedia core rules and killzones pages and the June 2026 update logs, then the Lite rules. Lite and Wahapedia agree except where noted. Edition leak list (do not import): 2021 shape distances, Overwatch, parry, wound rolls, AP vs armour, coherency, battle-shock, Command phase, Into the Dark close-quarters rules (Gallowdark and Tomb World only).

Conventions: all distances are inches; "operative" distances are measured between the nearest points of bases; "CR" means control range; "TP" means turning point; D6 results of 6 are always successes and crits, results of 1 always fail. Hit and Save "improve" means a lower number, "worsen" means a higher number, and nothing improves past 2+ or worsens past 6+.

## 1. Game sequence

- R-1.1 A battle is played by two players on a 30" x 22" killzone (terrain parts typed per R-11). It lasts four TPs, each a Strategy phase then a Firefight phase, in order and in full.
- R-1.2 Setup of the battle: choose the mission; type every terrain part; roll-off (R-8.13), the winner decides who has initiative for setup ("setup initiative"); place objective markers (always on the killzone floor); starting with the setup-initiative player, players alternate choosing different drop zones.
- R-1.3 Select operatives: each player picks a roster legal for their kill team, hidden until both reveal together. Then each player picks up to four equipment options (each option at most once per player), hidden until both reveal together. Each player then gains 2 CP.
- R-1.4 Set up equipment: starting with the setup-initiative player, players alternate placing one equipment item at a time (item by item, not option by option), obeying each item's placement constraints (see 11-missions.md).
- R-1.5 Set up operatives: starting with the setup-initiative player, players alternate placing batches of operatives. Each placed operative must be wholly within its owner's drop zone and gets a Conceal order.
  - RULING: a batch is `min(ceil(N/3), operatives left to place)` where N is the roster size, so N=6 gives 2/2/2 per player and N=10 gives 4/4/2. The sources say "one third, rounding up" without spelling out the last batch.
- R-1.6 The first TP's initiative is decided in its Strategy phase (R-2.1), with the tie-break "the player who did not have initiative during setup decides".
- R-1.7 The battle ends when the mission says so (four TPs for Preliminary Ops). If one player has no operatives left but the battle is not over, the other player keeps playing the remaining TPs out. Most VP wins; equal VP is a draw.
- R-1.8 Hidden information exists only in the two selection steps in R-1.3. After that all rosters and equipment are public.
- RULING: drop zone and territory geometry. The universal map key is an image. We use: the two player edges are the short (22") edges, the centreline is the line through the killzone centre parallel to those edges, a territory is the half-board on one side of the centreline (the line belongs to both), and a drop zone is the part of a territory within 3" of its owner's killzone edge. The 30" edges are neutral. Status Unsourced.

## 2. Strategy phase

- R-2.1 Initiative step: both players roll one D6. The higher roll decides which player has initiative. On a tie, the player who did not hold initiative in the previous TP (in TP1: during setup) decides, and this beats the normal roll-off re-roll. Initiative persists until the next Initiative step.
- R-2.2 Ready step: CP gain is 1 each in TP1. In every later TP the player without initiative gains 2 and the player with initiative gains 1. CP carry over with no cap. Then every player readies all their operatives (order token ready side up).
- R-2.3 Gambit step: starting with the initiative player, players alternate between using one STRATEGIC GAMBIT or passing. The step ends when both players have passed in succession. A pass does not forbid a later gambit after the opponent acts. All strategy ploys are STRATEGIC GAMBITS; other rules may also carry the keyword.
- R-2.4 A player cannot use the same STRATEGIC GAMBIT more than once per TP. Ploys cost 1 CP unless they say otherwise. CP cannot go below 0.
- R-2.5 A gambit effect marked "immediately" resolves at once; any other gambit effect lasts until the end of the TP.
- R-2.6 Effects that last "until the start of the next TP" (on guard, transmitting) end at that moment, before the next Strategy phase begins.
- R-2.7 Free actions granted during the Strategy phase are performed outside any activation, so they do not use up that action for the operative's later activation. Firefight ploys cannot be used outside the Firefight phase unless the ploy says so.

## 3. Firefight phase

- R-3.1 The initiative player activates one ready operative, then the other player does, and so on. An activation is: determine order, perform actions, become expended.
- R-3.2 When it is a player's turn to activate and they have no ready operative while the opponent still has one, they may counteract (R-3.11) instead; activation then returns to the opponent. When neither player has a ready operative, the phase ends. A player with a ready operative must activate it; they cannot pass.
- R-3.3 Order: the player picks Engage or Conceal. The order lasts until that operative's next activation. Operatives are set up with Conceal.
- R-3.4 Conceal: the operative cannot take the Shoot action (except with a Silent weapon) or the Charge action, cannot counteract, and is not a valid target while in cover (R-5.2). It may still Fight.
- R-3.5 Engage: the operative acts normally and can counteract.
- R-3.6 AP: the operative may spend at most its current APL in AP during an activation. Rules that change an action's cost can never take it below 0 AP, and this beats all other cost changes.
- R-3.7 Action restriction: an operative cannot perform the same action twice in one activation unless a rule says it can (for example "two Shoot actions"). Unique actions, mission actions and free actions are the other action types.
- R-3.8 Actions are chosen one at a time after seeing the previous result. If an action cannot be completed once begun (a move with no legal end location), it is cancelled: restore the previous state and spend no AP.
- R-3.9 Free action: its conditions must still be met, it costs no AP, and it still counts as that action having been performed for other rules. A free action performed outside the operative's activation does not block the same action during its activation, and the reverse. A rule that bans an action "during that activation or counteraction" still bans it when it is performed as a free action outside an activation.
- R-3.10 Expended: once a player finishes an operative's activation it becomes expended (not ready). An operative that is activated and ends with zero actions cannot be interrupted by a Guard (R-4.9).
- R-3.11 Counteract preconditions: all of the acting player's operatives are expended and the opponent has at least one ready operative, and it is the acting player's turn to activate. The player may pick one expended operative that has an Engage order.
- R-3.12 A counteracting operative performs one action that costs exactly 1 AP after cost modifiers (never Guard), for free. Each operative may counteract once per TP. Counteracting is optional. It is not an activation, so action restrictions do not apply. Moves made while counteracting may not exceed 2", or if the operative is removed and set up again it must be wholly within 2". This is not a Move stat change. The 2" is counted with all distance modifiers (Accessible +1", climbing, dropping), so a counteracting operative normally cannot pass through Accessible terrain. A cost reduction (for example Fall Back at 1 AP) can make that action legal as a counteraction.
  - RULING: the Lite text omits the Guard exclusion from counteract and the "removed and set up" 2" wording; the core text and the June 2026 errata are followed. Status Corrected.
- R-3.13 Firefight ploys are used during the Firefight phase. A player cannot use the same firefight ploy more than once per TP, except Command Re-roll.
- R-3.14 Command Re-roll (1 CP firefight ploy): after rolling attack or defence dice, re-roll one of those dice (R-9.3).
- R-3.15 An APL change in the middle of an activation limits the operative to AP equal to the new APL, but it may already have spent more. If the change lasts "until the end of its next activation" it also applies to the current activation if it is mid-activation.
- R-3.16 Stat changes that arise during an action (for example becoming injured) take effect once that action has fully finished. Weapon rule changes take effect immediately.

## 4. Universal actions

- R-4.1 **Reposition** (1 AP). Move up to the Move stat to a placeable location, in one or more straight-line increments. Each increment's length is rounded up to the next whole inch (a 0.5" increment costs 1", 2.75" costs 3") and the sum must be at most Move. Climb, drop and jump costs follow R-12. The operative may not move into an enemy's CR unless another friendly operative is already in that enemy's CR, in which case it may pass through but must not finish there. Not allowed while in an enemy's CR, or in an activation containing Fall Back or Charge.
- R-4.2 **Dash** (1 AP). As Reposition but at most 3" total, no climbing (dropping and jumping allowed). Not allowed while in an enemy's CR or in an activation containing Charge.
- R-4.3 **Fall Back** (2 AP). As Reposition but the operative may enter or leave enemy CR; it cannot finish in any enemy's CR. Allowed only if an enemy is in its CR at the start. Not allowed in an activation containing Reposition or Charge.
- R-4.4 **Charge** (1 AP). As Reposition but with Move + 2". The move may enter enemy CR and must end in an enemy's CR. If it enters the CR of an enemy that no other friendly operative is in the CR of, it cannot leave that enemy's CR for the rest of the move. Not allowed with a Conceal order, when already in an enemy's CR, or in an activation containing Reposition, Dash or Fall Back.
  - RULING: "cannot leave the lone enemy's control range" means once any point of the path is inside that enemy's CR, every later increment must remain inside that CR. Implemented per increment end-point and per sampled point along each increment. Status Unsourced.
- R-4.5 **Pick Up Marker** (1 AP). Remove a marker the operative controls that this action may be used on (only where a rule names such a marker); the operative now carries, contests and controls it. Not allowed in enemy CR or while already carrying a marker. v1 missions do not use it.
- R-4.6 **Place Marker** (1 AP). Place a carried marker within the operative's CR. An operative that is incapacitated while carrying must perform it first for 0 AP, beating every rule that would stop it. It cannot be performed in the same activation as Pick Up Marker (unless incapacitated).
- R-4.7 **Shoot** (1 AP). Run the sequence in R-5. Not allowed with a Conceal order (unless the chosen weapon is Silent) or while in an enemy's CR.
- R-4.8 **Fight** (1 AP). Run the sequence in R-6. Allowed only if an enemy is in the operative's CR.
- R-4.9 **Guard** (1 AP). The operative goes on guard (token). It counts as a Shoot action for conditions: no Conceal order, not in enemy CR. Heavy weapons do not stop it. Guard ends when any of these happens: the operative performs any action, moves or is set up; an enemy ends an action inside its CR and its player does not interrupt that activation; its order changes; the next TP starts. A counteraction cannot be Guard. A guarding operative may counteract; if it does, it is no longer on guard.
  - RULING: with two guarding operatives and one enemy action that ends in both their CRs, using the interrupt with either one satisfies "you interrupt that activation", so the other stays on guard. Status Unsourced.
- R-4.10 **Interrupt.** Once per enemy activation, after that enemy operative finishes an action, the guard's owner may interrupt: one friendly operative on guard performs Fight or Shoot for free (including actions treated as those). That operative cannot counteract for the rest of the TP. Pick the target normally; it need not be the interrupted operative. The interrupted activation continues afterwards if the enemy operative is still in play.
- R-4.11 **Point-blank shot.** An interrupting guard operative that is in an enemy's CR may still Shoot. It must target an enemy in its own CR (even if that enemy would not be a valid target), worsens its weapons' Hit by 1, and until the end of the interrupted activation it cannot retaliate.
- R-4.12 Interrupts are performed during the interrupted operative's activation, so firefight ploys may be used in them, but rules requiring "during this operative's own activation" do not apply.
  - RULING: Heavy (R-10.9) restricts only the operative's own activations and counteractions; an interrupt is neither, so a Heavy weapon may be used at an interrupt even if the operative moved earlier. Status Unsourced.
- R-4.13 Unique actions (team rules) and mission actions (mission or equipment) follow R-3.6 to R-3.9. An action "treated as" another action (Grappling Hook as Reposition) counts as that action for all restrictions.
- RULING: Guard is treated as a universal action in every killzone. Wahapedia prints its text under the Gallowdark close-quarters section, but the core page action list, the core Counteract text (which excludes Guard), the Heavy weapon rule (which mentions Guard) and the June 2026 commentary on Guard with Dakka Dash all assume it exists in open killzones such as Volkus. Status Corrected.

## 5. Shoot sequence

Attacker = active operative's player. Defender = the target's player.

- R-5.1 Select weapon: one ranged weapon the operative has. Collect Atk attack dice. Weapon rules that depend on distance, Heavy and Limited are checked here.
- R-5.2 Select valid target: an enemy that has no friendly operative in its CR, plus: if the target has Engage it must be visible to the shooter; if Conceal it must be visible and not in cover. Range x (R-10.14) filters candidates first.
- R-5.3 Visible: a straight 1mm line from the shooter's head to any part of the target's miniature, not blocked by terrain; bases are ignored. An operative is always visible to itself.
  - RULING: the engine models an operative as a cylinder (base radius, height) with a head point at its top. Visibility is true if any ray from the head point to any sampled point of the target cylinder is unblocked by terrain solids (Light, Heavy, Blocking, Barred per R-11). Status Unsourced.
- R-5.4 In cover: there is intervening terrain within the target's CR, and the target is not within 2" of the shooter. Intervening (R-8.8) excludes Exposed terrain.
- R-5.5 Obscured: there is intervening Heavy terrain, except Heavy terrain parts within 1" of either operative. A target cannot be in cover from and obscured by the same terrain feature: if it would be, the defender chooses, when the target is selected, either cover or obscured for the whole sequence. Terrain Heavy and connected to Vantage terrain that the shooter or target is standing on is ignored for obscured (R-11.5).
  - RULING: when the choice is forced, choosing "cover" removes the shared features from the obscured set and choosing "obscured" removes them from the cover set; each status is then re-evaluated from the remaining features. Status Unsourced.
- R-5.6 Roll attack dice. Any result >= the Hit stat is a success; 6 is a critical success (crit); 1 always fails; all other successes are normal; non-successes are discarded. Re-rolls (R-9.3) happen before a die is retained or discarded. Weapon rules that retain dice without rolling (Accurate) reduce the dice actually rolled.
- R-5.7 Retention order: roll, re-roll, apply Hit/Lethal to classify, then apply rules that retain a die as something else (Punishing, Rending, Severe), then obscured. A die can be retained only once; a die retained by rule X (Accurate, Punishing, Rending) cannot be retained again by another rule. Severe is the exception because it changes an already-retained die. If several weapon rules apply at the same step, the attacker chooses their order. Retained-without-rolling dice have no numeric result and cannot be re-rolled.
- R-5.8 Obscured effect: all the attacker's crits are retained as normal successes and can never be turned into crits (this beats every other rule, including Lethal, Rending and Severe), and the attacker discards one success of their choice. Because no crit is retained, rules that need a retained crit (Devastating, Piercing Crits, Punishing, Rending, Stun) do not trigger.
- R-5.9 Defence dice: the defender collects 3 dice, minus the Piercing x amount (R-10.12; Piercing Crits only if a crit was retained). Minimum 0.
- R-5.10 Cover save: if the target is in cover and the weapon lacks Saturate, the defender retains one of the collected dice as a normal success without rolling it, then rolls the rest. If no dice were collected there is nothing to retain.
  - RULING: the cover save is taken from the dice left after Piercing, so Piercing 1 against a target in cover means 2 dice: 1 retained, 1 rolled. Status Unsourced.
- R-5.11 Defence roll: >= the target's Save is a success, 6 is a crit, 1 fails, otherwise normal. Re-rolls apply before retain/discard.
- R-5.12 Resolve defence dice (blocking): the defender assigns each success to attack dice. A normal blocks one normal; two normals together block one crit; a crit blocks one normal or one crit. Blocked attack dice and the dice used are discarded. With Brutal, only crits can block (R-10.4); a crit then blocks one die.
- R-5.13 Resolve attack dice: every unblocked success inflicts the weapon's Normal Dmg (normal success) or Critical Dmg (crit) on the target. Successes resolve simultaneously; a rule that reduces or ignores damage from "one attack dice" is applied by the defender to one of them, and it also reduces any extra damage that same die deals.
- R-5.14 Incapacitation (R-7.2) is processed at the end of the whole action, so a Blast or Torrent action completes all sequences before any removal.
- R-5.15 Devastating damage is inflicted immediately when the crit is retained (before defence dice), is not "damage from an attack dice", and cannot be reduced by rules that reduce a die's damage. If the target is incapacitated by it the rest of the sequence still resolves for dice and rules, but removal waits for the end of the action.
- R-5.16 When a rule makes a player both attacker and defender (Blast secondary friendly operative), that same player rolls both sides.
- R-5.17 Hot (R-10.8) and Limited (R-10.11) are resolved after the whole action finishes.
- R-5.18 Operatives incapacitated in an action are removed after the action; carried-marker placement (R-4.6) and "before removal" free actions run first, each incapacitated operative's owner choosing the order, and at most one free action (excluding Place Marker) per incapacitated operative.

## 6. Fight sequence

- R-6.1 The active operative's player is the attacker. Select an enemy operative in the active operative's CR; it retaliates.
- R-6.2 Both players pick one melee weapon their operative has and collect Atk dice. If a rule says an operative cannot retaliate, it collects no dice and none are resolved for it.
- R-6.3 Both roll simultaneously and retain by R-5.6 to R-5.8 (no obscured, no cover). Any friendly operative that assists improves its fighter's melee weapon Hit by 1 per assisting operative. An assister must be in the CR of the enemy fighter in that fight and not in the CR of any other enemy operative. Siege Specialist-style effects can deny enemy assists.
- R-6.4 Re-rolls in a fight: both players may re-roll; they alternate (re-roll one die, or pass) starting with the initiative player until both pass in succession.
- R-6.5 Resolve: starting with the attacker, players alternate resolving one retained, unresolved die each. Each resolved die must either strike or block.
  - Strike: inflict Normal Dmg (normal) or Critical Dmg (crit) on the enemy fighter immediately, then discard the die.
  - Block: discard the die and one enemy unresolved die it can block (normal blocks normal; crit blocks normal or crit). A player may block even when the enemy has no unresolved dice left; the die is simply used up.
- R-6.6 When one player has no unresolved dice, the other resolves all of their remaining dice in order (strike or block each).
- R-6.7 If either fighter is incapacitated at any point, the sequence ends at once and all unresolved dice are discarded. The incapacitated operative is removed when the action ends.
- R-6.8 Shock (R-10.20), Dueller-type effects and rules that change blocking apply at the block step.
- R-6.9 Assist and fight rules apply to both the attacker's and the retaliator's side; the retaliator's friends may assist the retaliator by the same test.
- R-6.10 Rules "after this operative fights or retaliates" run after the sequence finishes, only if the named conditions hold.
- R-6.11 Door Fight and other treated-as-Fight actions follow R-6 using the treated-as CR relation.
- R-6.12 A fighter's Hit improvement from assists and its worsen from being injured both apply when the dice are rolled and are combined (net change).

## 7. Damage and status

- R-7.1 Damage reduces wounds. Starting wounds are the Wounds stat.
- R-7.2 At 0 or fewer wounds the operative is incapacitated, then removed. Incapacitated and removed are separate: some rules fire in between. Order for competing rules: "would be incapacitated" rules, then "is incapacitated" rules (including when it incapacitates another), then "before removal" rules.
- R-7.3 Wounded: fewer than starting wounds. Injured: fewer than half starting wounds (strictly fewer, so 5 of 10 is not injured, 4 is). Injured operatives lose 2" of Move (floor 4", R-9.6) and worsen the Hit of all weapons by 1.
- R-7.4 Wounds can only be regained by a rule; regaining during a "before removal" free action does not prevent removal.
- R-7.5 Damage from a rule that inflicts "x damage" directly is simply damage; it does not interact with save or blocking.
- R-7.6 Hit worsen from injury is included when comparing to Hot's D6 (R-10.8).

## 8. Key principles

- R-8.1 Bases: every operative has a base (mm on its datacard). Bases may touch but not overlap or stack. Friendly operatives (miniature and base) can be moved through but not finished on; enemies cannot be moved through. Bases cannot cross terrain or the killzone edge.
- R-8.2 Control range: a thing is in an operative's CR if it is visible to it and within 1". CR is mutual between operatives: if A is visible to and within 1" of B, each is in the other's CR.
- R-8.3 Distances: measure from the closest part of the base for operatives, ignoring the miniature; areas are measured horizontally only. "Within x" is met by any part being at most x away; "wholly within x" needs every part at most x away. An operative is within and wholly within any distance of itself and of a marker it carries; a carried marker counts as being where its carrier is.
  - RULING: operative-to-operative distances on different levels are straight-line 3D distances between nearest base points; areas and drop-zone checks are horizontal. Status Unsourced.
- R-8.4 Markers: objective markers are 40mm; every other marker is 20mm. They sit at precise places and may lie under operatives.
- R-8.5 Contest: an operative contests a marker in its CR. A carrier is the only operative that contests and controls its marker.
- R-8.6 Control: a player controls a marker if the total APL of their contesting operatives exceeds the opponent's total. Control cannot change mid-action; evaluate it between actions.
- R-8.7 Operatives: friendly are yours, enemy are the opponent's. Keywords on datacards (faction keyword, class keyword) are matched exactly by rules.
- R-8.8 Intervening and targeting lines: draw 1mm lines from any point of the shooter's base to every facing part of the target's base (2D top-down unless operatives are at different heights, then 3D). Terrain crossed by at least one line is intervening; by all lines is wholly intervening. The shooter's player picks the origin point.
  - RULING: the engine picks, for the attacker, the origin among sampled base points (centre plus 8 rim points) that is best for the attacker's outcome (not obscured first, then not in cover). The defender cannot override it. Status Unsourced.
- R-8.9 Cover and obscured are determined per shooter/target pair when needed; the 2" rule in R-5.4 uses shooter-to-target distance.
- R-8.10 Equipment: each option at most once per player per game.
- R-8.11 Ploys: costs and timing per R-2.4 and R-3.13.
- R-8.12 Killzone floor: the lowest level. Anything on a marker on the floor is on the floor.
- R-8.13 Roll-off: both roll one D6, the highest wins, ties re-roll.

## 9. Dice, precedence and stat limits

- R-9.1 D6 results compared as `x+` or ranges. D3 = roll a D6, halve, round up (1-2 gives 1, 3-4 gives 2, 5-6 gives 3). `nD6` sums n dice; `D6+k` adds k.
- R-9.2 A roll can never be re-rolled more than once; the original result may not be kept. A die that was retained automatically (cover save, Accurate) has no result and cannot be re-rolled. Making an opponent re-roll an already re-rolled die is not allowed.
- R-9.3 Re-roll order: a player holding several re-rolls may use them in any order and may see an earlier result first. If both players hold re-rolls at once (fights), they alternate (re-roll one die or pass) starting with the initiative player until both pass in succession.
- R-9.4 Precedence, highest first: a rule that says it takes precedence; designer's commentary; a rule that is not in the core book beats the core book; a rule saying "cannot" beats one saying "can"; the active operative's player decides; the initiative player decides.
- R-9.5 When several rules modify the same stat, apply all improvements and worsens as one net sum, then clamp per R-9.7 and the APL/Move limits in R-9.6.
- R-9.6 APL: any number of changes to an operative's APL are summed but the final APL is never more than 1 above or 1 below its printed APL. Move can never be reduced below 4".
- R-9.7 Hit stat lower bound 2+ and upper bound 6+ for rules purposes; a natural 1 always fails and a natural 6 always succeeds.
- R-9.8 Weapons with the same primary name and different bracket names are separate profiles. A rule naming the primary name affects all of them.
- R-9.9 "In an order of your choice" means the order in which something resolves, not Engage/Conceal.

## 10. Weapon rules

A weapon gains nothing from repeating the same rule unless it has an x, in which case the player selects which x to use.

- R-10.1 **Accurate x:** retain up to x attack dice as normal successes without rolling them (the dice count towards the Atk pool). Several Accurate instances combine to Accurate 2, which beats the x values. Vantage grants Accurate 1 or 2 (R-11.5).
- R-10.2 **Balanced:** re-roll one attack die.
- R-10.3 **Blast x:** the chosen target is primary. After it, shoot at each secondary target with the same weapon, in any order, as separate sequences. Secondaries are other operatives that are visible to and within x of the primary, valid regardless of Conceal, including friendly operatives. They count as in cover and obscured exactly as the primary was, including improved cover saves from Vantage. A rule that bars an operative from being selected does not stop it being a Blast secondary.
- R-10.4 **Brutal:** the defender may block only with crits.
- R-10.5 **Ceaseless:** re-roll any attack dice that show one result you choose (for example all 2s).
- R-10.6 **Devastating x:** each retained crit immediately inflicts x damage on the operative being attacked. With a distance prefix (for example Devastating 1" x), it hits that operative and every other operative visible to and within that distance of it. The crit stays and can still be resolved later.
- R-10.7 **Hot:** after the action, roll one D6 (once only even for Blast or Torrent). If it is lower than the weapon's current Hit stat, the user takes 2 x the roll as damage.
- R-10.8 (Hot detail) Hit changes during the action (injury, point-blank, markers) count when comparing.
- R-10.9 **Heavy:** the operative cannot use the weapon in an activation or counteraction in which it moved, and cannot move in one in which it used it. "Heavy (Dash only)" or similar permits only that named move. It does not stop the Guard action.
- R-10.10 **Lethal x+:** successes with a result >= x are crits (a die must already be a success).
- R-10.11 **Limited x:** after x uses in the battle the operative loses the weapon. A multi-sequence action counts once.
- R-10.12 **Piercing x:** the defender collects x fewer dice. **Piercing Crits x:** the same, but only if a crit was retained.
- R-10.13 **Punishing:** if at least one crit is retained, retain one failed die as a normal success.
- R-10.14 **Range x:** only operatives within x of the active operative can be valid targets.
- R-10.15 **Relentless:** re-roll any attack dice.
- R-10.16 **Rending:** if at least one crit is retained, retain one normal success (retained by rolling) as a crit.
- R-10.17 **Saturate:** the defender cannot retain cover saves.
- R-10.18 **Seek:** for valid-target selection, enemies cannot use any terrain as cover. **Seek Light:** they cannot use Light terrain as cover. This can make a target selectable but does not remove its cover save. A shooter on Vantage with Seek Light may choose to use only Seek Light and deny itself the improved Vantage cover save.
  - RULING: the Lite text limits Seek to Conceal targets while the Wahapedia appendix says all operatives. Only Conceal targets are affected by cover in valid-target selection, so the two readings are equivalent. Status Confirmed.
- R-10.19 **Severe:** if no crit was retained, change one retained normal success to a crit. Devastating and Piercing Crits still trigger from it; Punishing and Rending do not.
- R-10.20 **Shock:** the first time you strike with a crit in a sequence, also discard one enemy unresolved normal success (or an unresolved crit if there is no normal).
- R-10.21 **Silent:** the Shoot action can be used with this weapon under a Conceal order.
- R-10.22 **Stun:** if at least one crit is retained, the defender's APL is reduced by 1 until the end of its next activation (applied after the action, R-3.16, subject to R-9.6).
- R-10.23 **Torrent x:** pick a valid target as primary, then any number of other valid targets within x of the primary that have no friendly operative in their CR. Shoot at all as separate sequences in any order; each target's own cover and obscured apply. Torrent 0" means no secondaries but keeps the Torrent keyword for other rules.
- R-10.24 When more than one weapon rule applies at the same moment, the attacker orders them.
- R-10.25 Weapon rule changes (for example Balanced granted by a doctrine) apply immediately and can be gained mid-action.
- R-10.26 Distance Devastating, Blast and Torrent gain Lethal 5+ in two situations: Cityfight (R-13.3) and close-quarters killzones (out of scope).

## 11. Terrain traits

A terrain feature is made of parts; each part has one or more types. Treat types per part, not per feature.

- R-11.1 **Heavy:** can obscure.
- R-11.2 **Light:** no extra rule; other rules (Vantage, Seek Light) refer to it.
- R-11.3 **Blocking:** represents gaps visibility cannot cross. For cover and obscured it counts as intervening like the terrain around it.
- R-11.4 **Barred:** visibility cannot pass through it unless the viewer or the viewed operative is horizontally within 1" of it.
- R-11.5 **Vantage:** an upper level that operatives can finish a move on; it is also Light. Non-Vantage terrain can be moved over but no operative may finish a move on it or be set up on it.
  - (a) A Vantage shooter against an Engage target at least 2" lower gains Accurate 1; at least 4" lower gains Accurate 2.
  - (b) When selecting a target for a Vantage shooter, Conceal enemies at least 2" lower cannot use Light terrain for cover. The target keeps its cover save, which the defender may retain as a crit instead, or add one more cover save (one improvement only, not cumulative with Stealthy-type effects).
  - (c) For obscured, ignore Heavy terrain connected to Vantage terrain the shooter or the target stands on; "connected" means any part of the same terrain feature. Exception: standing on a Volkus stronghold fire step does not ignore the rest of the stronghold.
- R-11.6 **Accessible:** operatives can move through it; it costs +1" extra, and only the centre of the base needs to pass through (base size irrelevant). This beats base and terrain-movement rules.
- R-11.7 **Insignificant:** ignored for climbing and dropping; operatives cross it without going up and down.
- R-11.8 **Exposed:** never intervening for cover or obscured.
- R-11.9 **Ceiling:** an operative with a round base of at most 50mm, or an oval 60x35mm base, can move beneath it regardless of height; it must still end in a placeable spot.
- R-11.10 Vantage-on-Light stacks: a Vantage part is Light, so an operative on Vantage is often in cover from lower enemies.
- R-11.11 Vantage obstructed movement: an operative on Vantage may move around obstructions (enemies, other terrain) while some part of its base stays on that Vantage terrain.
- R-11.12 A terrain feature's part types come from its killzone definition (Volkus list in R-13).

## 12. Movement over terrain

- R-12.1 Operatives cannot move through terrain; they go around it, climb over it, or drop or jump off it. They must end a move in a placeable location; they cannot end midway through a climb, drop or jump, and if no such end exists they cannot begin the move.
- R-12.2 Climb: allowed up terrain that is visible to the operative, with the climbed terrain within 1" horizontally and 3" vertically. Every climb counts as at least 2" vertically (a 1" climb costs 2"). Total the vertical distance of consecutive climb segments in one action before rounding, and continue a climb while the next terrain is within 1" horizontally and 3" vertically.
- R-12.3 Drop: when moving off terrain, or after a jump, ignore the first 2" of vertical drop in an action (a total of 2" per action, not per drop). Only drops beyond 2" cost movement.
- R-12.4 Jump: from Vantage terrain more than 2" above the killzone floor, an operative may jump up to 4" horizontally in a single straight-line increment, then must drop or climb. If a rampart is at the edge, climb it first and jump from its highest point. Jumping onto a feature ignores a height difference of 1" or less, including its rampart. Dash may drop and jump but not climb.
- R-12.5 Costs combine: movement used = sum of rounded horizontal increments + rounded climb distance + dropped distance beyond the free 2" + Accessible surcharges. A drop above Insignificant terrain is ignored.
- R-12.6 Ladders and Breach markers modify these costs (see 11-missions.md and 13-teams.md).
  - RULING: vertical distance for climbs and drops uses the same straight-line increment model: climbs total across segments then round up once; each horizontal increment rounds separately. Status Confirmed (matches the June 2026 commentary examples of 4" for 2" + 1.5").

## 13. Volkus killzone specifics (v1 killzone)

- R-13.1 Part types: Stronghold upper levels are Ceiling and Vantage; the door is Accessible and Heavy; fire steps are Vantage, Insignificant and Exposed; the broken vent is Blocking; the barrel containers on Stronghold A are Blocking and Heavy; the small broken ramparts on Stronghold A's Vantage edge are Insignificant and Exposed; the gap on Stronghold B's lower Vantage is Accessible; everything else is Heavy. Large ruin: upper level Ceiling and Vantage (treated as the first stronghold upper level height for targeting), upper rampart Light, door Accessible and Heavy, door viewpoint Blocking, unbroken windows Barred and Heavy, the rest Heavy. Small ruin and heavy rubble are Heavy; light rubble is Light.
- R-13.2 For CR visibility ignore the door and any part of a stronghold below 2" height; for CR visibility of a large ruin ignore the door. Only one friendly operative may stand on Stronghold B's highest upper level, placed on one side (an enemy may still use the other side).
- R-13.3 Cityfight: Blast, Torrent and distance Devastating weapons also have Lethal 5+ if the target is wholly within a stronghold and on the killzone floor or a fire step (judged per target, so a secondary outside does not gain it). An operative wholly inside a stronghold that retaliates against one not wholly inside resolves its dice first in the fight sequence.
- R-13.4 Door Fight (1 AP, treated as Fight): select an enemy on the killzone floor within 2" of and on the other side of a door the active operative touches; for that action they count as in each other's CR. Not allowed in an enemy's CR or when the base does not touch a door.
- RULING: Compound Siege, Tyranid Infestation, Gallowdark, Tomb World and Bheta-Decima killzone rules are out of scope for v1. Status Unsourced.
