# STATUS (rewritten 2026-10-26, end of the first overnight run)

Play: https://dragoonant.github.io/mancermundo/ (deploys from `main`).

## What exists
| Area | State |
|---|---|
| Gangs | Goliath and Escher: fighters, weapons, wargear, equipment lists, starter gangs (`src/data/gangs/*`), 284 records, `validate:data` clean |
| Boards | 5 Zone Mortalis boards (`src/data/zm/boards`): foundry-run, bulkhead-gauntlet, cistern-crossing, hive-heart, sump-warren; walls, doors, ductways, terminals; procedural walls and floors |
| Scenarios | Tunnel Skirmish, Smash & Grab, Forgotten Riches (all playable; crew selection, casket placement, tile deployment, scoring, victory) |
| Engine | Priority, Action and End phases; group activations; move, charge, retreat, take cover, crawl, doors, ductways; shooting (hit/wound/save, Firepower and ammo, blasts, templates, stray shots, pinning); close combat (reactions, parry, coup de grace, consolidate); Injury dice, Seriously Injured, recovery with assists; nerve, Broken, flee, rally; bottle tests (incl. voluntary); Horrors in the Dark; replay/save with hash |
| Not yet in the engine | **41 skill and wargear code hooks** (e.g. Nerves of Steel, Iron Jaw, Step Aside, Counter-attack, chem stashes): listed on fighter cards, no effect in play. Only 3 of 44 hooks are implemented |
| AI | `src/ai`: utility decider (random/easy/normal tiers), every decision kind answered; normal beats random 39/40 (gate >= 95%), normal beats easy 18-2-4; client plays `normal` inline (~4 ms a decision) |
| Client | Start screen, gang picker, briefing, battle screen, prompts with engine odds, fighter card, hover glossary, casualty tray, dice tray (Firepower and Injury glyphs), event feed, end screen, save/continue, phone layout |
| Figures | 27 Hunyuan GLBs (one per fighter role, weapon fused), matched to fighters by a name heuristic (`figures/BattleFighter.tsx` `matchBody`); status pips and chips over each figure |
| Audio | 84 ids in `public/audio` (6 music, 4 ambience, 11 announcer lines, SFX); wired to events, music director, Sound button; **not auditioned by ear** (`public/sounds.html`) |
| VFX | Muzzle flash, tracers, flame, blast, impacts, melee sweeps, death effects through the presentation director |

## Gates (last run 2026-10-26)
typecheck clean; vitest 50 files / 535 tests; `validate:data` ok; `sim --games 50` 0 violations, 0 rejections; `bench:ai --games 40` 39W 1L GATE OK; Playwright 26/26 plus one full bot-vs-bot browser game per scenario (all ended with a winner, no console errors).

## Rulings
271 `RULING:` lines in `docs/needs-rules-check.md`, 204 marked Unsourced (no primary text at hand; worth a pass with the rulebook).
