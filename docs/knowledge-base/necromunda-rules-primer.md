# Necromunda (2023 rulebook) rules primer

One-page orientation for engineers coming from the Kill Team sibling project. The binding spec is `docs/spec/10-rules-core.md` (core), `11-scenarios.md` (missions) and `12-rules-test-checklist.md` (test IDs). Open questions live in `docs/needs-rules-check.md`.

## What the game is

Necromunda is Games Workshop's gang skirmish game set in the underhive of a hive city. Each side runs a gang of roughly 6-10 individually equipped fighters (Leader, Champions, Gangers, Juves). Our v1: one battle (no campaign), a flat Zone Mortalis board of 12" tiles with walls, doors and ductways, Goliath vs Escher, human vs AI.

## Shape of a battle

- Rounds, each with three phases. Priority: roll off, then every fighter gets a Ready marker. Action: players alternate activating one Ready fighter at a time (Leaders bring up to 2 nearby friends along, Champions 1); each fighter gets two actions. End: Bottle test, fleeing, Recovery for Seriously Injured fighters, Rally for Broken ones.
- Actions are Simple (repeatable), Basic (once per activation) or Double (both actions). Move is Simple, Shoot and Fight are Basic, Charge is Double.
- Fighters are Standing (Active or Engaged) or Prone (Pinned face up, or Seriously Injured face down). Any standing fighter hit by a gun is Pinned, so firefights constantly knock people flat.
- Shooting: closest-target priority (Cool test to pick another), short/long range accuracy, cover as a hit penalty, D6 vs BS, a Firepower die for ammo and Rapid Fire, then the classic S vs T wound table, armour save modified by AP, Damage removes Wounds.
- At 0 Wounds you roll Injury dice: Flesh Wound (-1 T), Seriously Injured (down, can crawl, may recover), Out of Action (gone). In the 2023 book extra Serious Injury results stack as Flesh Wounds, so fights are lethal.
- Close combat is an exchange: the attacker rolls attack dice against WS with assists and interference, then every engaged enemy still standing makes reaction attacks. Parry forces re-rolls. Seriously Injured enemies can be finished with Coup de Grace.
- Morale is personal: nerve tests within 3" when a friend drops, Broken fighters must run for cover, and the gang as a whole can bottle and start fleeing.

## Differences from Kill Team (and 40k)

- No APL, no action points: always two actions, with Simple/Basic/Double types. No orders (Conceal/Engage), no counteract, no Guard/overwatch, no CP, no ploys, no equipment points.
- No attack-dice-then-defence-dice duel. Every hit goes through hit roll, wound roll (S vs T table), save roll, then Damage and Injury dice. Saves are per hit, on the defender, one D6 each.
- Facing matters: a 90 degree vision arc limits shooting and melee targets, and Backstab/shields use it. Kill Team has no facing.
- Wounds are small (usually 1-2); the Injury dice decide fate, not a wounds track. Being "injured" in KT has no equivalent.
- Activation is one fighter at a time but Leaders and Champions can group-activate. There is no turning point limit by default; the battle ends when a gang is gone or by scenario.
- Pinning on every ranged hit, prone-and-in-cover fighters cannot be shot, and morale (Broken, Bottle) has no Kill Team analogue.
- Measurements are closest base edge to edge, line of sight on the 2D board is from base centre to base, and walls plus closed doors are the only things that block it.

## Where the full rules live

The official text is in the paid Necromunda Rulebook (2023) and is not reproduced here. Free supporting sources used: a fan compilation of official text up to the 2023 book (Necrodamus), the Esoteric Order of Gamers summary of the 2017 Underhive box, Warhammer Community's July 2023 article on the new book, and the yaktribe.games N23 errata thread. Raw copies are in `docs/sources/rules/` (gitignored, never published). Note: GW released a new edition, Necromunda Skirmish, in August 2026; our target remains the 2023 book by owner decision.

## Edition leak list (paste into every rules prompt)

This project implements the 2023 Necromunda Rulebook only. Do NOT use: 1995 Necromunda rules (player turns in which one side moves, shoots and fights with every model in movement/shooting/hand-to-hand/recovery phases; hand-to-hand decided by "combat score" = best attack die + WS with the difference as hits; injury D6 with a "Down" result; a 2D6 vs leader's Leadership bottle test at the start of the turn once 25 percent are down, which ends the game on a fail); Kill Team rules (APL, AP costs, Conceal/Engage orders, counteract, Guard, control range, Hit and Save stats rolled as attack and defence dice, critical hits, CP and ploys); Warhammer 40k rules (units and coherency, player-turn phases, command points and stratagems, invulnerable saves, damage spilling between models in a unit); Necromunda Underhive 2017 (N17) details that later books changed (Fleeing tested at the start of the Action phase instead of the End phase, -1 to hit across barricades, Running for Cover moving only D6", group activation as an automatic Leader/Champion rule instead of a Group Activation (X) profile ability; and from N17/N18 alike: extra Serious Injury results not stacking, Recovery with no Flesh Wound on a Serious Injury result, no -2 for blasts aimed at the floor, no -1 for charging an unseen target); and the 2026 Necromunda Skirmish edition (Suppressed status, Agility tests, "Single" actions, Dash action, Ammo (X+) trait, a Save characteristic on every fighter, close combat in Initiative order, gang-wide bottle checks against the highest Leadership, scenario card decks, specialisations for Gangers, "Injured" instead of Flesh Wound). If a rule is not in our spec, ask; do not fill it from another edition.
