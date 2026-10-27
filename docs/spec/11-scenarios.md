# 11 - Scenarios (v1 skirmish, Zone Mortalis)

Three skirmish scenarios adapted 1:1 in mechanics from the 2023 rulebook's Underhive scenarios, minus campaign rewards. Our own wording. IDs M-x.y are referenced by `12-rules-test-checklist.md`; core rule references are R-x.y in `10-rules-core.md`. Rulings are logged in `docs/needs-rules-check.md`.

Source key as in `10-rules-core.md`. Scenario sources: [ND] Necrodamus N23 compilation p286-306 (battlefield setup, "Scenario 1: Tunnel Skirmish / Stand-off", "Scenario 3: Forgotten Riches", "Scenario 6: Smash & Grab"), cross-checked against [YT23] for N23 setup minimums.

## 1. Common skirmish setup

Source: [ND] p227 (Skirmish), p278-279 (pre-battle sequence, crew selection), p286-287 (battlefield setup); owner v1 scope.

- M-1.1 Gangs: one Goliath gang and one Escher gang. The human picks a side; the AI plays the other. Each side brings a pre-built roster from the gang-data spec (a standard 1000-credit starting gang).
- M-1.2 Crew selection methods (the scenario names one): Custom (X) = the owner picks up to X fighters from the roster; Random (X) = X fighters drawn at random; Hybrid (X+Y) = X chosen, then Y drawn at random from the rest. If the roster is smaller than the number asked for, the whole roster is used. The AI chooses its Custom picks with its own heuristic.
- M-1.3 Starting crew size = the number of fighters actually deployed. It is the number used by the Bottle test (R-13.1).
- M-1.4 Attacker and defender: where a scenario has them, roll off; the winner chooses. (The campaign "challenge" step does not exist in v1.)
- M-1.5 Battlefield: a hand-authored Zone Mortalis board built from 12" tiles (R-15.1), meeting the N23 minimums (R-15.12). Default size 2x3 tiles (24" x 36"). Each scenario lists which boards are legal. Board edges are walls.
- M-1.6 Standard deployment: divide the board into two halves across its long axis. The defender (or roll-off winner) picks a half and sets up its whole crew, then the other player. Every fighter must be at least 12" from the dividing line, which on a 24" x 36" board means within 6" of the owner's short edge. Fighters are set up Standing, facing chosen by the owner, not overlapping walls, obstacles or each other.
  - RULING: the 2023 book removed its generic deployment ([YT23]); the compilation's default ("at least 12" from the dividing line") is used.
- M-1.7 Tactics cards: none in v1 (the scenarios normally grant Custom (2) plus underdog cards).
- M-1.8 First round: roll for Priority normally (R-5.2) unless the scenario says otherwise.
- M-1.9 Battle end (all three scenarios): checked at the end of each round; the battle ends when at most one gang still has fighters on the battlefield (R-5.8). Fled fighters count as Out of Action.
- M-1.10 A gang that bottles voluntarily (R-13.1) and then flees loses automatically in Smash & Grab and Forgotten Riches (scenario text). In Tunnel Skirmish it simply stops scoring.
- M-1.11 No campaign rewards (credits, XP, reputation) are calculated. The result screen reports winner, points and fighters lost.

## 2. Tunnel Skirmish (Stand-off)

Source: [ND] p301 "Scenario 1: Tunnel Skirmish / Stand-off".

A straight gang fight in the tunnels: put the other side down.

- M-2.1 Board: 6 tiles (2x3), any authored v1 board.
  - RULING: the 4-tile option exists in the source (Custom (6)) but standard deployment cannot fit on a 24" x 24" board; it is deferred.
- M-2.2 Crews: Custom (10) each.
- M-2.3 Deployment: standard (M-1.6). No attacker or defender; the roll-off winner deploys first and also picks the half.
- M-2.4 Scoring: each gang scores when an enemy fighter goes Out of Action or flees: 3 for the Leader, 2 for each Champion, 1 for any other fighter.
- M-2.5 Ending: M-1.9.
- M-2.6 Victory: the gang with more points wins; equal points is a draw.
  - RULING: fighters still Seriously Injured on the battlefield when the battle ends do not score (only Out of Action and fled fighters are listed).

## 3. Smash & Grab

Source: [ND] p306 "Scenario 6: Smash & Grab".

The attacker raids a stash of locked crates; the defender must drive them off before three are cracked.

- M-3.1 Board: 6 tiles (2x3), any authored v1 board.
- M-3.2 Attacker and defender: M-1.4.
- M-3.3 Crews: attacker Custom (8); defender Hybrid (3+D6).
- M-3.4 Before deployment the defender places 5 loot caskets in its own half, each at least 4" from every board edge, outside walls and obstacles, lids closed. No other caskets are used. No spacing between caskets is set (they may not overlap).
  - RULING: "in their deployment zone" is read as the defender's half of the board (the 6" deployment strip is too small for five caskets 4" from the edge); caskets are also at least 6" apart.
- M-3.5 Deployment: standard (M-1.6), defender first.
- M-3.6 Only the attacker may open caskets (Smash Open or Bypass Lock, R-15.11). The defender may not open them but may Carry them.
  - RULING: the scenario forbids only opening; carrying by the defender is allowed.
- M-3.7 When the attacker opens a casket, roll D6 instead of the normal contents: 1 = booby trapped: a 5" Blast centred on the casket, every fighter under it suffers a S4 AP - Damage 1 hit (pinning as a ranged hit; no hit roll); 2-5 = valuables; 6 = jackpot. Then remove the casket. Each opened casket counts toward victory whatever the roll.
- M-3.8 Ending: M-1.9.
- M-3.9 Victory: the attacker wins if at least 3 caskets were opened by the end of the battle; otherwise the defender wins. If the defender bottles voluntarily and then flees, the attacker wins (M-1.10).
  - RULING: the battle does not end early when the third casket is opened; the attacker has already secured the win, so the result is locked and play may continue to the normal end only if the human chooses (the AI concedes).

## 4. Forgotten Riches

Source: [ND] p303 "Scenario 3: Forgotten Riches" (marked 2D, Zone Mortalis).

Both gangs search a dark sector for abandoned loot and haul it back to their own entry tile.

- M-4.1 Board: 7 tiles. One centre tile; the other six each share at least half an edge with the centre tile ("brick" layout: one tile on the left and one on the right, two tiles above offset by half a tile, two below likewise). v1 ships fixed authored 7-tile boards; the tile-placing step is skipped.
- M-4.2 Crews: Custom; maximum crew size from 2D6: 2-3 = 5, 4-5 = 6, 6-8 = 7, 9-10 = 8, 11-12 = 9. One roll applies to both gangs.
  - RULING: the source does not say whether each gang rolls separately; one shared roll is used for fairness.
- M-4.3 Loot: players alternately place 5 loot caskets, roll-off winner first: the first in the centre tile, each in a different tile, at least 6" apart, not in inaccessible spots. No distance from the board edge is set.
- M-4.4 Deployment: the roll-off winner picks a tile without a casket as its deployment tile and deploys within 3" of that tile's outer board edge; the other player then does the same on another remaining casket-free tile. If the two deployment tiles touch, no fighter may be set up within 6" of an enemy.
- M-4.5 Horrors in the Dark: when a fighter activates more than 8" from every other fighter (friend or enemy), roll D6: 1 = it suffers a S6 AP -1 Damage 2 hit, and if this leaves it Seriously Injured it is dragged off and goes Out of Action; 2-3 = it may take no actions this activation; 4-5 = only one action; 6 = normal.
  - RULING: all fighters on the battlefield, including Seriously Injured and Broken ones, count as "other fighters" (the compilation's opposite reading is a house rule).
- M-4.6 Caskets are opened and carried with the normal actions (R-15.11), using the normal contents table; an ammo-cache result stops it counting as loot.
- M-4.7 Scoring: 1 point per enemy that goes Out of Action (fled counts); 2 points per loot casket (not ammo cache) on the gang's own deployment tile within 3" of the board edge when the battle ends; D3 points for being the last gang on the battlefield.
- M-4.8 Ending: M-1.9.
- M-4.9 Victory: the gang that secured the most loot caskets (M-4.7 condition) wins; equal caskets is a draw. Points (M-4.7) are shown on the result screen and break nothing; in the source they only decide a campaign XP bonus. If a gang bottles voluntarily and then flees, the opponent wins and claims all caskets left on the board.
  - RULING: victory is by caskets, not points, exactly as the source states; points are reported for information.
