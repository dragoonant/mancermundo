# STATUS (updated 2026-10-26: skills, rulebook pass, watch mode)

Play: https://dragoonant.github.io/mancermundo/ (deploys from `main`).

## What exists
| Area | State |
|---|---|
| Gangs | Goliath and Escher: fighters, weapons, wargear, equipment lists, starter gangs (`src/data/gangs/*`), 284 records, `validate:data` clean |
| Boards | 5 Zone Mortalis boards (`src/data/zm/boards`): foundry-run, bulkhead-gauntlet, cistern-crossing, hive-heart, sump-warren; walls, doors, ductways, terminals; procedural walls and floors |
| Scenarios | Tunnel Skirmish, Smash & Grab, Forgotten Riches (all playable; crew selection, casket placement, tile deployment, scoring, victory) |
| Engine | Priority, Action and End phases; group activations; move, charge, retreat, take cover, crawl, doors, ductways; shooting (hit/wound/save, Firepower and ammo, blasts, templates, stray shots, pinning); close combat (reactions, parry, coup de grace, consolidate); Injury dice, Seriously Injured, recovery with assists; nerve, Broken, flee, rally; bottle tests (incl. voluntary); Horrors in the Dark; replay/save with hash |
| Skills and wargear | All 42 skill, wargear and fighter-rule code hooks implemented (S4K): passives in `src/engine/skills/passive.ts`, close combat and skill actions in `src/engine/skills/{combat,actions,hurl,somersault,stance}.ts`. New actions: Headbutt, Hurl, Overseer, Immovable Stance, Unleash the Beast, Somersault; Naaargah!, Hit and Run, Lightning Reflexes, Stimm-slugs, Chem-synth and Combat Chems ask through `skill.choice`; harmless optional skills apply automatically. `validate:data` now fails on any unregistered code hook. Checklist SKL-001..025, SKC-001..029 |
| AI | `src/ai`: utility decider (random/easy/normal tiers), every decision kind answered; normal beats random 39/40 on two seeds (gate >= 95%); skill actions scored (`src/ai/skills.ts`), normal beats easy 18-2-4; client plays `normal` inline (~4 ms a decision) |
| Client | Watch AI vs AI mode (start-screen entry or `?watch=1`: pause, step, Slow/Normal/Fast/Instant, pause on attacks, follow camera, a card showing each AI decision with its odds, Watch again); H key / eye button hides and restores every panel; start screen, gang picker, briefing, battle screen, prompts with engine odds, fighter card, hover glossary, casualty tray, dice tray (Firepower and Injury glyphs), event feed, end screen, save/continue, phone layout |
| Figures | 27 Hunyuan GLBs (one per fighter role, weapon fused), matched to fighters by a name heuristic (`figures/BattleFighter.tsx` `matchBody`); status pips and chips over each figure |
| Audio | 84 ids in `public/audio` (6 music, 4 ambience, 11 announcer lines, SFX); wired to events, music director, Sound button; **not auditioned by ear** (`public/sounds.html`) |
| VFX | Muzzle flash, tracers, flame, blast, impacts, melee sweeps, death effects through the presentation director |

## Gates (last run 2026-10-26, after the rulebook pass and watch mode)
typecheck clean; vitest 54 files / 624 tests; `validate:data` ok (every code hook registered); `sim --games 30` 0 violations, 0 rejections; `bench:ai --games 40` GATE OK; Playwright 34/34 (desktop and three phones).

## Rulings
233 `RULING:` lines in `docs/needs-rules-check.md` after the rulebook pass (the 82 inherited Kill Team rulings were removed): 66 Confirmed, 21 Corrected, 79 Fan-source (Necrodamus compilation only), 34 Port choice, 33 Unsourced (no text available settles them).
