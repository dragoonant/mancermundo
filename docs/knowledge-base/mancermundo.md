# Mancermundo (Necromunda), first overnight run, 2026-10-26

Zone Mortalis skirmish, Goliath vs Escher, 2023 rules, player vs AI. M0 to a playable Pages build with three scenarios, five boards, a utility AI, 27 Hunyuan figures and 84 generated sounds in one overnight run. Sources: this repo's git log, `STATUS.md`, `HANDOFF.md`, `docs/spec/05-migration.md`.

## What worked
- **Copy the sibling's `origin/main`, quarantine, port by table.** Murder Squad's code went into `legacy/` (outside tsconfig and vitest; a boundary test forbids imports from it). `docs/spec/05-migration.md` gave every legacy file a verdict (KEEP / ADAPT / DELETE) and an owning stage, so each agent brief was a file list. `legacy/` was deleted once the last client stage landed, with the last commit that had it recorded in HANDOFF.
- **Parallel stages with disjoint file lists.** End phase + scenarios (engine), utility AI (`src/ai`, tools) and dice tray + audio + vfx (client) ran at the same time without conflicts. Each brief said which folders were off limits and asked for the *one line* the main loop should change elsewhere (the AI agent reported the client bot switch instead of editing `store/game.ts`).
- **Commit around in-flight work with pathspec excludes** (`git add -A -- . ':!src/ai' ...`) so finished stages ship while another agent is still writing.
- **The AI bench is a rules fuzzer.** It found a set-up dead-end (Forgotten Riches tile deployment with no spot 6" from the enemy) that 750 sim games with simpler bots had not.
- **Engine-owned odds everywhere** (`query.*`): prompts, fighter cards and the AI read the same numbers.

## What bit
- **Budget.** About 3M tokens was approved; the run used roughly 9-10M. Biggest items: gang data research (about 0.76M), the shooting stage (0.55M), and the three parallel end-of-night stages (0.69M + 0.77M + 0.38M). A full Necromunda engine with three scenarios is about 3x a Kill Team port; estimate accordingly or defer skills/scenarios explicitly.
- **Clickable meshes swallow clicks behind them.** Door groups had `onClick` + `stopPropagation` in every phase, so deploy and move clicks on the floor behind a door did nothing while the hover still said "Deploy here". Gate interactive handlers by the pending decision kind.
- **The prompt panel covers the screen centre at 1280x720.** A camera `lookAt` on a target puts it under the panel; e2e clicks must check the projected pixel is clear (loop over camera offsets).
- **A subagent with its own background work re-sent its hand-back several times.** Stop it with `TaskStop` once its report is in.
- **The browser pane cannot render while the app window is in the background** (overnight). Use headless Playwright scripts against the dev server instead.
- **Data shape surprises:** `state.data.weapons` holds only the rostered weapons (tests use the full bundle); the Firepower dice's ammo symbol is on face 1 in the data, not 6.
- **41 of 44 skill hooks were deferred** to save tokens; cards list skills that do nothing. Say so in the UI or implement before calling a build "faithful".

## Numbers at the end of the night
50 test files / 535 tests; sim 50 games 0 violations; normal AI beats random 39/40 and easy 18-2-4; Playwright 26/26 plus one full browser game per scenario; 271 rulings (204 Unsourced).
