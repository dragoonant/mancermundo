# Kill Team (2024 edition, "Hivestorm") rules primer

Source: the free official Lite Rules PDF (July 2025 revision, copyright 2024), saved as `docs/sources/kt-lite-rules-jul25.pdf` and extracted to `kt-lite-rules-jul25.txt` (gitignored folder; never commit GW text). Core-rules detail checked against wahapedia.ru `kill-team3_/the-rules/core-rules`. Team rules are free at warhammer-community.com (one PDF per kill team, e.g. `eng_28-01_kill_team_team_rules_imperial_navy_breachers-*.pdf`) and on Wahapedia (`kill-team3_/kill-teams/<slug>`, which returns 403 to plain fetches, so read it in the browser pane). Mission packs (Approved Ops: crit ops, tac ops, kill op, killzone maps) are in the Core Book / Approved Ops cards and summarised on Wahapedia `the-rules/the-missions/` and `the-rules/killzones/`.

## Shape of the game
- Two players, each a kill team of operatives (typically 6-14 models). Killzone 30" x 22" (inches, not the 2021 shapes). 10 D6. Four turning points per battle unless the mission says otherwise.
- Each player starts with 2 CP (gained when selecting operatives), gains 1 CP in each Strategy phase; from the second Strategy phase on, the player without initiative gains 2 CP instead. Ploys cost 1 CP; each ploy once per turning point except Command Re-roll (re-roll one attack or defence die after rolling).
- Setup: killzone and terrain, roll for initiative, drop zones from the mission map (or within 3" of a killzone edge). Players alternate setting up one third of their kill team (rounding up), wholly within the drop zone, each operative given a Conceal order.

## Turning point
1. **Strategy phase:** each player rolls a D6; the highest decides initiative (ties: the player without initiative decides). CP gain. Ready all operatives. Alternate STRATEGIC GAMBITs (every strategy ploy is one) or pass until both pass in succession.
2. **Firefight phase:** alternate activating ready operatives, starting with the initiative player. On activation choose the order (Engage or Conceal), then perform actions costing AP up to the operative's APL (normally 2, some 3); the same action cannot be performed twice in an activation unless stated. Then the operative is expended. When all operatives are expended the turning point ends.
   - **Counteract:** when all your operatives are expended but your opponent's are not, each time you would activate, one expended friendly operative with an Engage order may perform a 1AP action for free (once per operative per turning point, moving at most 2").
   - Firefight ploys are used in this phase.

## Orders
- **Engage:** acts normally and can counteract.
- **Conceal:** not a valid target while in cover, but cannot Shoot or Charge (Silent weapons are the exception).

## Universal actions
| Action | AP | Rules |
|---|---|---|
| Reposition | 1 | Move up to Move stat to a legal location; cannot move within control range of enemies; not while within enemy control range, nor in the same activation as Charge or Fall Back. |
| Dash | 1 | Like Reposition but at most 3" and no climbing; not within enemy control range; not in the same activation as Charge. |
| Fall Back | 2 | Like Reposition but may move through enemy control range and must finish outside it; only when an enemy is within control range; not with Reposition or Charge. |
| Charge | 1 | Like Reposition with +2"; may enter enemy control range and must finish there; cannot leave the control range of the first lone enemy it engages; not with a Conceal order, not while already in control range, not with Reposition, Dash or Fall Back. |
| Shoot | 1 | See below; not with a Conceal order, not within enemy control range. |
| Fight | 1 | See below; only when an enemy is within control range. |
| Pick Up Marker / Place Marker | 1 | Mission/objective interaction (core rules). |
| Guard | 1 | Killzone/core rule: lets an operative react later (counts as an Engage-type stance); Heavy weapons do not block it. |

Injured (fewer than half starting wounds): Move -2", Hit stats worsened by 1. Wounds 0 or less: incapacitated and removed.

## Control range, visibility, cover, obscured
- **Control range:** visible to and within 1" of the operative; mutual.
- **Visible:** an unobstructed straight line from the operative's head to any part of the target, excluding bases (true line of sight from behind the model).
- **Cover:** intervening terrain within the target's control range; never while within 2" of the attacker.
- **Obscured:** intervening Heavy terrain between shooter and target (Heavy terrain within 1" of either operative does not count): the attacker discards one success and crits become normal successes.
- **Valid target:** Engage order: visible. Conceal order: visible and not in cover.
- Terrain traits (killzone rules): Light, Heavy, Vantage, Insignificant, Exposed, Accessible (climbing/traversal). Full definitions on the Wahapedia killzones page; to be read during spec writing.

## Shoot
1. Attacker selects a ranged weapon. 2. Selects a valid enemy target with no friendly operatives in its control range. 3. Rolls attack dice = Atk; each result >= Hit is a success; 6 is always a critical success, 1 always fails. 4. Defender rolls three defence dice; each >= Save is a success (6 crit, 1 fail); if in cover, one defence die may be retained as a normal success without rolling (cover save). 5. Defender blocks: a normal blocks a normal; two normals block a crit; a crit blocks a normal or a crit. 6. Each unblocked success inflicts Normal Dmg or Critical Dmg.

## Fight
1. Attacker picks an enemy within control range; it retaliates. 2. Both pick a melee weapon. 3. Both roll Atk dice (successes >= Hit; 6 crit; 1 fail). 4. Starting with the attacker, alternate resolving one success at a time: **strike** (inflict Normal/Critical Dmg) or **block** (a normal blocks a normal; a crit blocks a normal or a crit).

## Weapon rules (Lite list)
Accurate x, Balanced, Blast x, Brutal, Ceaseless, Devastating x (and distance Devastating), Heavy (and Heavy (Dash only)), Hot, Lethal x+, Limited x, Piercing x / Piercing Crits x, Punishing, Range x, Relentless, Rending, Saturate, Seek / Seek Light, Severe, Shock, Silent, Stun, Torrent x. Exact wording in the extracted text; implement each as a data-driven weapon rule with a hook point in the attack/fight sequence.

## Scoring (mission packs, to confirm during spec)
Approved Ops 2024: each player scores from a **crit op** (objective markers, up to 6 VP), a **tac op** (chosen from the team's archetype, up to 6 VP) and a **kill op** (operatives incapacitated, up to 6 VP), with VP capped per category (20 VP total in the current mission pack). Exact tables come from Wahapedia `the-missions/`.

## Kill teams (2024 edition roster, free team rules online)
At launch 33 teams were updated for the new edition, with quarterly balance updates and new boxes since (e.g. Terror on Devlan, May 2026). Teams with the best existing MGSD figure coverage from Mallet 42k's 236 GLBs: Angels of Death / Intercessors (Primaris marines), Kommandos (Ork boyz), Plague Marines, Legionaries and Nemesis Claw (chaos legionaries), Hunter Clade (skitarii rangers/vanguard), Hand of the Archon (kabalites), Pathfinders (T'au pathfinders), Wyrmblade (GSC neophytes/acolytes), Hearthkyn Salvagers (hearthkyn), Warpcoven (scarab occult, tzaangors), Novitiates / Sisters (battle sisters), Blades of Khaine (aeldari guardians as a base), Death Korps / Kasrkin (cadians as a base), Hierotek Circle (necron warriors as a base), Farstalker Kinband, Vespid Stingwings and Tempestus Aquilons (no coverage).

## Edition leak list (put in every rules prompt)
- 2021 edition (Octarius): triangle/circle/square/pentagon distances (now inches), 6 defence dice variants, "Overwatch" action (removed), APL 2 for everything (now per operative), old crit op scoring, Fight sequence "parry" wording (now "block"), old cover rules (Light/Heavy obscuring differently).
- 40k 10th edition: unit coherency, wound rolls (Kill Team has no Strength vs Toughness wound roll), armour saves modified by AP (Kill Team uses Piercing and defence dice), Command phase CP, battle-shock, Overwatch stratagem.
- Into the Dark / Gallowdark close-quarters rules apply only to that killzone, not to open killzones.
