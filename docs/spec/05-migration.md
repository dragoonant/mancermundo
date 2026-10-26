# 05 - Migration from the Kill Team code base

How the copied Murder Squad code (M11, 24 teams) becomes the Necromunda contract of `00-architecture.md` and the data of `20-data-schema.md`, file by file, and the stage plan to a playable build. Verdicts:

- **KEEP**: moved back from `legacy/` unchanged (or with an import path fix only).
- **ADAPT**: moved back and edited; the line says what changes. History is kept with `git mv`.
- **REPLACE**: a new file written against the new contract; the legacy file (same or old name) is reference only.
- **DELETE**: removed in S1, never ported.

## 0. Method: quarantine, then port

1. S1 moves `src/engine`, `src/ai`, `src/client`, `src/data/*.ts`, `src/data/schema`, `src/vfxGallery.tsx`, `vfx.html` and `tests/` into `legacy/` with `git mv` (same relative paths: `legacy/src/engine/...`, `legacy/tests/...`). `legacy/` is outside the `tsconfig` include and the vitest include (`tests/**/*.test.ts`), so the build is green from S1 on with only ported files.
2. S1 deletes everything marked DELETE outright (it never enters `legacy/`), so `legacy/` holds only reference material.
3. Each stage `git mv`s the KEEP/ADAPT files it owns from `legacy/` back to their place, edits ADAPT files, and writes REPLACE files reading the legacy file for structure. An implementer never imports from `legacy/` (`boundaries.test.ts` refuses it).
4. Module files exist from S1 as stubs (`export const shootModule = stubModule('shoot', ['shoot'])`) and are imported by `modules.ts` from day one, so later stages edit only their own module file, never the table.
5. Data areas have their own index files (`src/data/{core,gangs,zm,scenarios}/index.ts`) created by S1D as empty lists, so stages adding data never touch the same index.
6. `legacy/` is deleted by the main loop after S5c and S6 have both landed.
7. Tools are not typechecked (`tsconfig` include is `src`, `tests`); `tools/sim-core.ts`, `sim.ts`, `ai-bench.ts`, `ai-match.ts` stay in place but are not run until the stage that rewrites them.

## 1. File verdicts

### 1.1 Engine (`src/engine/`)

| File | Verdict | Stage | What changes |
|---|---|---|---|
| `rng.ts` | KEEP | S1 | - |
| `decider.ts` | KEEP | S1 | - |
| `geometry.ts` | KEEP | S1 | `incrementCost` stays but is no longer called (Necromunda measures exactly) |
| `footprint.ts` | KEEP | S1 | round bases only in practice |
| `registry.ts` | ADAPT | S1 | `Ctx.roll(purpose, n, die = 'd6')` emits `DiceRolled.die`; events carry `round` instead of `turningPoint`; `ctx.rollD3/rollScatter` helpers |
| `apply.ts` | ADAPT | S1 | `afterAction`: engagement refresh, nerve queue drain hook, casualty settle (stubs in S1); drops `updateControl`, `runDeferredRemovals`, `refreshFlags` |
| `modules.ts` | ADAPT | S1 | new table: setup, priority, activation (`action`), movement (`move`), shoot, fight, endphase (`end`), scenarios (`scenario`), skills (`skill`, plus `dice.reroll` override) |
| `index.ts` | ADAPT | S1 | exports `suggest`; drops `missionView`, `playableTeams`, KT bundle helpers; adds `bundleFromData`, `rosterFromStarter` re-export in S2 |
| `actions.ts` | ADAPT | S1 | `act.*` for every new decision kind (activate, group, choose, path, deploy with facing, weapon, target, aim, allocate, fightWeapons, split, after, bottle, assist, recoveryPick, crew, role, zone, casket, flee, confirm) |
| `view.ts` | ADAPT | S1 | strip `rng`/`log` only |
| `state.ts` | ADAPT | S1 | fighter helpers (`getFighter`, `onBoard`, `seatFighters`, `readyFighters`, `enemiesOf`, `friendsOf`); `cloneState`, `canon`, `hashState`, `EngineInvariantError`, `SEATS`, `otherSeat` kept; APL/injured/marker helpers dropped |
| `hooks.ts` | ADAPT | S1 | registry functions, window opener and frame resumes kept; `HOOK_NAMES` replaced: `stat.modify`, `test.modify`, `action.available`, `action.type`, `shoot.targets`, `shoot.hitMods`, `fight.hitMods`, `fight.attackDice`, `weapon.traits`, `wound.mods`, `save.mods`, `damage.mods`, `injury.dice`, `injury.applied`, `pin.allowed`, `nerve.mods`, `move.limit`, `fighter.downed`, `activation.start`, `activation.end`, `round.start`, `round.end`, `phase.end`; KT attack hooks removed |
| `code-hooks.ts` | ADAPT | S1 | `CodeHookDef { name, kind: skill \| rule \| wargear \| weapon \| scenario \| casket, params?: (p) => string \| null, install(): void }`; fire counts kept; ploy offer seeds removed |
| `effects.ts` | ADAPT | S1 | timed effects and `expireEffects` kept (expiry keys `activation`, `round`, `battle`, `startOfActivation:<id>`); CP, ledger, APL and `regainWounds` removed; `directDamage` moves to `hits.ts` |
| `types.ts` | REPLACE | S1 | contract of `00-architecture.md` sections 3-7 (primitives, `PendingDecision`, envelope, `StepResult`, `SaveFile`, `Rejection` keep their shapes) |
| `events.ts` | REPLACE | S1 | event families of 00 section 5 |
| `bundle.ts` | REPLACE | S1 (types) / S2 (adapter) | `EngineBundle` and `GameData` snapshot in S1; `bundleFromData` (data records -> runtime: parse `"4+"`, weapon `str`, ranges, traits; boards via `board.ts`) in S2 |
| `terrain.ts` | REPLACE -> `board.ts` | S1Z | compile ZM boards (tiles, rotation, outline walls) into `BoardDef`; dynamic door state helpers |
| `los.ts` | REPLACE | S2 | 2D line of sight vs wall/door polygons and smoke, vision arc, cover verdict (00 section 7.3); `segmentPolygonIntervals` / `segmentCircleInterval` from geometry reused; KT heights, Vantage, obscured removed |
| `measure.ts` | REPLACE | S2 | base-edge distance, `within` by path, contact, engagement (incl. barricades) |
| (new) `nav.ts` | REPLACE | S2 | visibility graph over wall/door/obstacle corners inflated by the base radius, Dijkstra, avoid discs, cache per door state and radius; `pathDistance`, `route`; API shape taken from `legacy/src/ai/nav.ts` (`distanceField`, `routeTo`) |
| `movement.ts` | ADAPT | S2 (S3a, S3b extend) | keep waypoint validation loop, half-inch sampling, `MovePlan`, `planMove`, `forcedMoveSpots`/`applyForcedMove`; drop climb/drop/jump/fly/ovals/increment rounding/control range; add exact path length, obstacle +1" crossings, the 1" rule, door rectangles, kinds `move/takeCover/crawl/retreat/consolidate/carry`; engine paths via `nav` for charge, running for cover, knockback, blaze, door push |
| `setup.ts` | REPLACE | S2 (S4 extends) | `createGame` (validate setup, fighters from rosters, board compile), roles, crew methods, zones, deployment; casket placement and tile deployment arrive in S4 |
| `strategy.ts` | REPLACE -> `priority.ts` | S2 | roll-off with the tie rule (R-5.2), `FightersReadied` (Blind exception) |
| `firefight.ts` | REPLACE -> `activation.ts` | S2 (S3a, S3b, S4 extend) | turn alternation, R-5.6 run-out, activate, group chain, action menu from `core/actions.json` and the derived status, Simple/Basic/Double/Free accounting, `canTurn`, end of activation, phase end -> End phase |
| `shoot.ts` | REPLACE | S3a | the R-8/R-9 sequence (00 decision kinds `shoot.*`) |
| `fight.ts` | REPLACE | S3b | the R-10 sequence (`fight.*`) |
| `attack-common.ts` | REPLACE -> `hits.ts` | S3a | resolve one hit (R-11), door hits, casualty records |
| `weapons.ts` + `handlers.ts` | REPLACE -> `traits.ts` | S3a (S3b extends) | trait handlers on hook points |
| `equipment.ts` | REPLACE -> `wargear.ts` | S3a | armour save item, wargear effects |
| (new) `morale.ts` | REPLACE | S3b | nerve queue, Broken, Running for Cover, rally helper |
| (new) `endphase.ts` | REPLACE | S4 | `end.*` |
| `markers.ts` | REPLACE -> `zm.ts` | S2 (S3a, S4 extend) | door, terminal, ductway and casket actions |
| `missions.ts` | REPLACE -> `scenarios.ts` | S4 | scenario steps, scoring, victory |
| `abilities.ts` | REPLACE -> `skills.ts` | S4K | skills, fighter rules, house rules |
| `kills.ts` | REPLACE -> `casualties.ts` | S3a | casualty log (who, how, round) |
| `dice.ts` | REPLACE | S2 (S3a extends) | D3/D66, test helpers (R-2.3 to R-2.5) in S2; Firepower/Injury/Scatter faces and exact odds in S3a |
| `query.ts` | REPLACE | S2 (S3a, S3b, S4 extend) | 00 section 7.6 |
| `teams/*.ts` (25) | DELETE -> `gangs/{index,goliath,escher}.ts` | S1 delete / S4K new | - |
| `conditions.ts`, `core-hooks.ts`, `guard.ts`, `ploys.ts`, `ploy-rules.ts`, `point-handlers.ts`, `pools.ts`, `psychic.ts`, `reserve.ts`, `tokens.ts`, `transform.ts`, `operative-picks.ts`, `team-rules.ts` | DELETE | S1 | Kill Team only |

### 1.2 Data (`src/data/`)

| File | Verdict | Stage | What changes |
|---|---|---|---|
| `geometry.ts` | KEEP | S1D | validator geometry |
| `refs.ts` | ADAPT | S1D | id index and ref checks over the new record types |
| `validate.ts` | ADAPT | S1D (S1Z, S1G add checks) | ajv set-up kept; checks of 20 section 12 |
| `types.ts` | REPLACE | S1D | mirror of the six schemas |
| `index.ts`, `manifest.ts` | REPLACE | S1D | area index files (20 section 1) |
| `roster.ts` | REPLACE | S1D | `rosterFromStarter`, starter-gang legality helpers |
| `loadout.ts`, `kill-grades.ts` | DELETE | S1 | KT selection rules |
| `schema/*.schema.json` (10) | REPLACE | S1D | six schemas of 20 section 12; `schema/index.ts` ADAPT |
| `core/*.json` (5), `teams/**` (24 x 6), `killzones/*` (6), `missions/*` (3) | DELETE | S1 | KT content |
| new `core/{actions,dice,constants,traits}.json` | REPLACE | S1D | rules data |
| new `core/{weapons,wargear,skills,fighter-rules}.json`, `gangs/**` | REPLACE | S1G | gang data from `13-gangs.md` |
| new `zm/**`, `scenarios/**` | REPLACE | S1Z | boards and scenarios |

### 1.3 AI (`src/ai/`)

| File | Verdict | Stage | What changes |
|---|---|---|---|
| `worker.ts`, `index.ts` | KEEP | S6 | message protocol unchanged |
| `tiers.ts` | ADAPT | S6 | weight names (`exposure`, `pin`, `down`, `ooa`, `casket`, `bottle`) |
| `decider.ts` | ADAPT | S6 | dispatch table on the new kinds; fallback to random kept |
| `random.ts` | ADAPT | S6 | continuous kinds answered with `engine.suggest` or a random legal point |
| `eval.ts` | REPLACE | S6 | fighter value (role, wounds, T after Flesh Wounds), outcomes from `query.expectedOutcome` (pin, SI, OOA weighted), pinning and Broken value |
| `threat.ts` | REPLACE | S6 | exposure at a spot: Ready enemies with line of sight and a possible turn, cover, Prone-in-cover = untargetable, charge reach `pReach` |
| `moves.ts` | REPLACE | S6 | activation planner over action pairs by status (move+shoot, aim+shoot, move+move, charge, take cover, stand up+move, reload, door and casket actions), group nomination value |
| `shoot.ts`, `fight.ts`, `setup.ts` | REPLACE | S6 | weapon/target/aim/allocate; weapons/split/after; role, crew picks, zone, casket spots, deployment |
| `nav.ts` | DELETE | S6 | replaced by `src/engine/nav.ts` |
| `ploys.ts`, `teamActions.ts`, `choices.ts` | DELETE | S1 | replaced by new `end.ts` (bottle, assist, recovery pick) and `skills.ts` (`skill.choice`, `dice.reroll`) in S6 |

### 1.4 Client (`src/client/`)

| Path | Verdict | Stage | What changes |
|---|---|---|---|
| `App.tsx` | ADAPT | S5a | screens start -> gang picker -> briefing -> battle -> end; `?lab` route kept for the S2L viewer |
| `params.ts` | ADAPT | S5a | `gangs=gol,esc`, `scenario`, `board`, `starter`; drop `mission/layout/teams` |
| `weaponFlavour.ts` | ADAPT | S5b | reads `weapon.flavour` from data, keeps the family enum |
| `audio/{manager,instance,settings,music,ids,index}.ts` | KEEP | S5b | - |
| `audio/eventSounds.ts` | ADAPT | S5b | map new events (HitRolled, FighterPinned, InjuryRolled, DoorChanged, BlastScattered...) |
| `board/{CameraRig.tsx,touchCamera.ts,cameraApi.ts}` | ADAPT | S2L | camera bounds from `BoardDef.bounds` |
| `board/FpsProbe.tsx`, `board/Vfx.tsx` | KEEP | S5b | - |
| `board/Terrain.tsx` | REPLACE -> `board/ZmBoard.tsx` | S2L | procedural floor tiles, instanced wall segments, doors (closed / open slide / destroyed), terminals, duct grilles, obstacles, caskets, props as boxes; drawn from `BoardDef` |
| `board/matTexture.ts`, `board/structureTexture.ts` | ADAPT -> `board/floorTexture.ts`, `board/wallTexture.ts` | S2L | procedural grate/plate/hazard floors, wall plating |
| `board/mats.ts`, `board/terrainGlb.ts` | DELETE | S1 | KT mats and terrain GLBs |
| `board/Board.tsx` | ADAPT | S5a | ZmBoard + fighters + overlays + camera |
| `board/Zones.tsx` | ADAPT | S5b | deployment regions, smoke, blast markers, templates, casket discs |
| `board/Sightlines.tsx`, `board/MeasureLayer.tsx` | ADAPT | S5b | `query.losLine` sample lines and vision arc wedges; straight and path distance |
| `bot/{aiWorkerClient,botTier,randomBot}.ts` | KEEP / ADAPT | S5a | `randomBot` uses `engine.suggest` for continuous kinds |
| `dev/scenarios.ts` | REPLACE | S5c | dev fixtures: shoot a pinned target, fight with assists, door closing on a fighter, blast scatter, recovery |
| `dice/DiceTray.tsx`, `dice/trayStore.ts` | ADAPT | S5b | rows per step (hit, wound, save, injury, ammo), Firepower and Injury faces drawn as glyphs, scatter arrow; no attack-vs-defence pools |
| `figures/Operative.tsx` | ADAPT -> `figures/Fighter.tsx` | S5b | posture (Pinned lies face up, Seriously Injured face down), vision arc wedge when selected, Ready/Broken/Blaze/Blind/Out of Ammo tokens, wound and Flesh Wound pips |
| `figures/{Procedural.tsx,glbLoader.ts,hold.ts}` | KEEP | S2L / S5b | Procedural stand-in archetypes for Goliath and Escher bodies |
| `figures/{attachmentFor.ts,cues.ts,cueCore.ts,manifest.ts,Gallery.tsx}` | ADAPT | S5b | Goliath/Escher weapons and archetypes; cues for shoot, fight, go prone, stand up, fall |
| `figures/OvalBase.tsx` | DELETE | S1 | - |
| `game/adapter.ts`, `game/defaults.ts` | ADAPT | S5a | `GameSetup` from starter gangs, scenario and board; default pairing Goliath vs Escher |
| `game/labels.ts` | ADAPT | S5a | feed lines for the new events |
| `game/promptLabels.ts`, `game/glossary.ts` | REPLACE | S5c | labels for the new kinds; Necromunda glossary in our own words |
| `game/kill.ts` | REPLACE -> `game/scenario.ts` | S5c | reads `query.scenarioView` |
| `interaction/controller.ts`, `interaction/Overlays.tsx` | ADAPT | S5a | deploy with facing, move path with exact length, 1" rings, obstacle cost, aim point/template direction, casket spot |
| `interaction/{sightData,sightStore,sightlines}.ts` | ADAPT | S5b | engine `losLine`, arc, cover verdicts |
| `presentation/{animStore,announceStore,feedStore,fxStore,idleStore,presentedStore,settings}.ts` | KEEP | S5a | - |
| `presentation/director.ts`, `heldVolley.ts`, `shotCamera.ts`, `deployCamera.ts` | ADAPT | S5a | beats for the new events (roll-off, priority banner, pinning fall, injury dice, nerve/broken banner, door slide, scatter, bottle); volleys from Firepower hits |
| `store/game.ts`, `store/session.ts` | ADAPT | S5a | new kinds in the bot loop and auto-skip, setup from gang picks |
| `store/saveGame.ts`, `store/testHooks.ts` | KEEP | S5a | `window.__ms` unchanged |
| `teams/*.ts` (25) | DELETE -> `gangs/{index,types,goliath,escher}.ts` | S1 / S5b | per-house paint, archetypes, attachments |
| `ui/{Tooltip,BottomSheet,theme,uiStore,widgets,collapse,formFactor,hudLayout,promptParts,Keyword,RotatePrompt}` | KEEP | S5a | - |
| `ui/DecisionPrompt.tsx`, `ui/BattleScreen.tsx` | ADAPT | S5a | bodies for deploy, move path, activate, group, choose; generic option list for the rest |
| `ui/AttackPrompts.tsx`, `ui/GamePrompts.tsx` | ADAPT | S5c | weapon profile cards (S/L range, accuracy, S, AP, D, Am, traits) with engine odds; targets with priority/cover/band badges; aim; allocate; fight weapons/split/after; crew, zone, casket, bottle, assist, recovery pick, skill choice; ploy UI removed |
| `ui/Panels.tsx` | ADAPT | S5c | OperativeCard -> FighterCard (profile line M WS BS S T W I A Ld Cl Wil Int with modified values highlighted, weapons table, wargear, skills, status and conditions) |
| `ui/{Hud,StartScreen,Briefing,EndScreen,TokenChips,tokenDefs,tokenInfo,markerInfo,SightlinePanel,MeasureTool}` | ADAPT | S5c | round, priority, bottled, fighters standing/down/OOA, scenario points; scenario and board pick; briefing from scenario text; result with casualties and points; Necromunda tokens; door/terminal/casket info |
| `ui/TeamBuilder.tsx` | REPLACE -> `ui/GangPicker.tsx` | S5c | pick house and starter gang per seat, read-only roster with fighter cards, scenario crew rules shown |
| `ui/HiddenTray.tsx` | ADAPT -> `ui/CasualtyTray.tsx` | S5c | Out of Action and fled fighters per seat |
| `vfx/*` | KEEP (`families.ts` ADAPT) | S5b | flavour families for stub, las, bolter, flamer, plasma, melta, grenade |
| `src/main.tsx` | ADAPT | S1 (placeholder) / S2L (lab) / S5a (app) | - |
| `src/vfxGallery.tsx`, `vfx.html` | KEEP | S5b | restored with the vite input |

### 1.5 Tests

| Path | Verdict | Stage |
|---|---|---|
| `tests/engine/boundaries.test.ts`, `smoke.test.ts`, `view.test.ts` | ADAPT | S1 |
| `tests/engine/code-hooks.test.ts` | ADAPT | S4 |
| `tests/engine/sim.test.ts` | ADAPT | S2 |
| `tests/engine/golden.test.ts` | REPLACE | S4 (a forced-dice round of Goliath vs Escher) |
| `tests/engine/dice.test.ts` | REPLACE | S2 (DICE, TEST) |
| new `tests/engine/{round,act,move,vis,zm,status}.test.ts` | REPLACE | S2 (S3b extends) |
| new `tests/engine/{shoot,blast,inj,trait}.test.ts` | REPLACE | S3a |
| new `tests/engine/{cc,nerve}.test.ts` | REPLACE | S3b |
| new `tests/engine/{end,scen}.test.ts` | REPLACE | S4 |
| new `tests/engine/{skills,gangs-goliath,gangs-escher}.test.ts` | REPLACE | S4K |
| `tests/engine/{abilities,core,equipment,fight,generic*,guard,integration,markers,missions,movement,orders,ploys,sequence,shoot,teams,terrain,weapons}.test.ts`, `tests/engine/teams/*` | DELETE | S1 |
| `tests/fixtures/helpers.ts`, `presentation.ts` | ADAPT | S2 / S5a |
| `tests/fixtures/team.ts` -> `gang.ts`, `maps.ts` -> `boards.ts`, `attack.ts`, `real.ts` | REPLACE | S1 (`gang.ts`), S2 (`boards.ts`, `real.ts`), S3a (`attack.ts`) |
| `tests/fixtures/layout-crossing.json` | DELETE | S1 |
| `tests/data/*` | REPLACE (`schemas`, `core` S1D; `boards`, `scenarios` S1Z; `gangs` S1G; `bundle-adapter` S2) | - |
| `tests/ai/{decider,worker,tiers}.test.ts`, `fixtures.ts` | ADAPT | S6 |
| `tests/ai/planner.test.ts` | REPLACE | S6 |
| `tests/ai/{batchB,batchC,batchD,newTeams}.test.ts` | DELETE | S1 |
| `tests/client/*` generic (`audioUnlock, collapse, noNativeTooltips, params, presentation, saveGame, shaderWarmup, touchCamera, vfx, heldVolley, store, rejections, prompts, labels, glossary, eventSounds, weaponFlavour, figures, attachments, interaction, sightlines, deployCamera, shotCamera, scenarios, activatePick, markerInfo`) | ADAPT | with the client stage that owns the file under test |
| `tests/client/{batchB,batchC,batchD,m9Teams,ovalGlb,mats,terrain}.test.ts` | DELETE | S1 (`zmBoard.test.ts` new in S2L) |
| `tests/e2e/{helpers,home,mobile-smoke,perf,save-game,start-options,ui-consistency,vfx,gallery,sightlines,play,full-game}.spec.ts` | ADAPT | S5a-S5c |
| `tests/e2e/{batch-c,batch-d,new-teams,oval-base,mats,terrain,team-builder,scenario-*}.spec.ts` | DELETE | S1 (`lab.spec.ts` S2L, `gang-picker.spec.ts` S5c new) |

### 1.6 Tools

| File | Verdict | Stage |
|---|---|---|
| `validate-data.ts` | ADAPT | S1D |
| new `board-svg.ts` | REPLACE | S1Z (boards), S2 (`--sim <seed>` draws fighters, arcs and move paths of a sim game) |
| `sim-core.ts`, `sim.ts` | ADAPT | S2 (S4 completes invariants) |
| `ai-bench.ts`, `ai-match.ts` | ADAPT | S6 (`--pair gol,esc`, scenario rotation) |
| `gen-volkus-layouts.ts` | DELETE | S1 |
| `gen-audio.ts`, `measure-audio.ts`, `build-sounds-page.ts`, `audio-manifest.json`, `art/`, `local-gen/`, `models/`, `textures/`, `vfx/`, `audio-src/` | KEEP | - (art and audio milestones) |

## 2. Stage plan to a playable build

Every stage: one Sonnet implementer unless marked; exact file list (moves from `legacy/` count with the file); gates run by the main loop; one commit `M<n>: ...`. Common gates: `npm run typecheck`, `npm test`, `npm run build`; from S1D `npm run validate:data`; from S2 `npm run sim -- --games 50 --seed 1`. Every engine test is named by checklist ID. Rulings found while implementing go to `docs/needs-rules-check.md` (the only shared file every stage may append to; append-only, one line each).

Parallelism (at most two agents at once, per CLAUDE.md):

```
S1  ||  S1D          (disjoint: engine skeleton vs src/data + tools/validate-data)
S1Z ||  S1G          (both after S1 + S1D; disjoint: zm/scenarios + board.ts vs gangs + core gang data)
S2                   (after S1Z + S1G)
S3a ||  S2L          (after S2; engine attack code vs client lab viewer)
S3b                  (after S3a)
S4  ||  S4K          (after S3b; end phase/scenarios/sim vs skills/house code)
S5a ||  S6           (after S4 + S4K; client core vs AI)
S5b ||  S5c          (after S5a; visuals vs screens/prompts)
```

Session-model involvement: **S1G implemented on the session model** (gang data fidelity). **Session-model review** of the diff against `10-rules-core.md` and the checklist: S1 (types.ts / events.ts vs 00 only), S2 (activation and movement), **S3a and S3b (full review: rules-dense)**, S4 (endphase, scenarios), **S4K (full review)**. S2L, S5a-c and S6 are reviewed by gates and screenshots only.

### S1 - Quarantine and engine contract skeleton (Sonnet)

Operations: the `git mv` of section 0.1 and the deletions of section 1 (counted as two operations).
Files:
1. `src/engine/types.ts` (REPLACE, 00 sections 3-7 verbatim incl. `BoardDef`, `GameSetup`)
2. `src/engine/events.ts` (REPLACE)
3. `src/engine/actions.ts` (ADAPT)
4. `src/engine/rng.ts`, 5. `decider.ts`, 6. `geometry.ts`, 7. `footprint.ts` (KEEP)
8. `src/engine/registry.ts`, 9. `apply.ts`, 10. `modules.ts`, 11. `index.ts`, 12. `view.ts`, 13. `state.ts`, 14. `hooks.ts`, 15. `code-hooks.ts`, 16. `effects.ts` (ADAPT)
17. `src/engine/bundle.ts` (`EngineBundle`, `GameData` snapshot from an already runtime-shaped bundle; no data adapter yet)
18. module stubs `src/engine/{setup,priority,activation,movement,shoot,fight,endphase,scenarios,skills}.ts` (one `stubModule` export each; `setup.ts` also holds a minimal `createGame` that builds the state from the fixture bundle, places nothing and raises `setup.role` with two options)
19. `src/main.tsx` (placeholder page: name, "engine rebuild in progress", link to the repo)
20. `vite.config.ts` (drop the `vfx` input until S5b)
21. `tests/fixtures/gang.ts` (synthetic runtime bundle: house `test`, a leader with Group Activation (2), a champion (1), two gangers, a juve; a pistol, a basic gun with Rapid Fire (1), a blast launcher, a flamer template, a melee weapon with Parry, a power weapon; flak armour)
22. `tests/engine/boundaries.test.ts` (refuses `legacy/` imports), 23. `tests/engine/smoke.test.ts` (createGame deterministic hash, rejection keeps the same state reference, replay reproduces hashes), 24. `tests/engine/view.test.ts`
Gates: typecheck, test, build. Visible: placeholder page screenshot and the test summary.

### S1D - Data layer (Sonnet, parallel with S1)

Files:
1. `src/data/types.ts` (REPLACE), 2. `index.ts`, 3. `manifest.ts` (REPLACE), 4. `refs.ts`, 5. `validate.ts` (ADAPT), 6. `geometry.ts` (KEEP), 7. `roster.ts` (REPLACE)
8. `src/data/schema/index.ts` (ADAPT), 9-14. `src/data/schema/{common,core,item,gang,zm,scenario}.schema.json`
15. `src/data/core/index.ts`, 16. `src/data/gangs/index.ts`, 17. `src/data/zm/index.ts`, 18. `src/data/scenarios/index.ts` (area indexes; gangs/zm/scenarios empty)
19. `src/data/core/actions.json` (the R-6.3 table), 20. `dice.json`, 21. `constants.json`, 22. `traits.json` (every R-14.2 name; `implemented: true` for the R-14.3 list)
23. `src/data/core/{weapons,wargear,skills,fighter-rules}.json` as `[]` placeholders (filled by S1G)
24. `tools/validate-data.ts` (ADAPT), 25. `tests/data/schemas.test.ts`, 26. `tests/data/core.test.ts`
Gates: typecheck, test, validate:data. Visible: `validate:data` output listing the core records.

### S1Z - Zone Mortalis boards and scenarios (Sonnet, after S1 + S1D, parallel with S1G)

Files:
1-6. `src/data/zm/tiles/*.json` (six own-design 12" tiles: corridor junction, cross-roads, chamber with barricades, locked bulkhead with terminals, duct room, loading bay)
7-11. `src/data/zm/boards/*.json` (three `2x3` boards, two `brick7` boards; each meets ZM-012)
12-14. `src/data/scenarios/{tunnel-skirmish,smash-and-grab,forgotten-riches}.json`
15. `src/data/zm/index.ts`, 16. `src/data/scenarios/index.ts`
17. `src/engine/board.ts` (REPLACE terrain.ts: compile tiles with rotation into `BoardDef`, outline walls, door/terminal/duct/obstacle polygons, deployment regions per scenario kind, `doorState` helpers)
18. `src/data/validate.ts` (board and scenario checks of 20 section 9)
19. `tools/board-svg.ts` (writes `tools/out/board-<id>.svg`: tiles, walls, doors, terminals, ducts, obstacles, casket spots, deployment regions)
20. `tests/data/boards.test.ts`, 21. `tests/data/scenarios.test.ts`, 22. `tests/engine/board.test.ts` (ZM-001, ZM-012, rotation round-trip)
Gates: typecheck, test, validate:data. Visible: the five board SVGs.

### S1G - Goliath and Escher data (session model, after S1D, parallel with S1Z)

Needs `docs/spec/13-gangs.md`. Files:
1-8. `src/data/gangs/goliath/{house,fighters,weapons,wargear,skills,rules,equipment-lists,starter-gangs}.json`
9-16. `src/data/gangs/escher/{...same eight}.json`
17-20. `src/data/core/{weapons,wargear,skills,fighter-rules}.json`
21. `src/data/gangs/index.ts`, 22. `src/data/validate.ts` (starter-gang legality and cost checks), 23. `tests/data/gangs.test.ts` (fighter-type counts and starter rosters as listed in `13-gangs.md`)
Every weapon carries `flavour`; every skill or rule beyond the declarative vocabulary uses `{ "code": ... }` with a name S4K will register (validate:data may list them as pending until S4K: `--allow-pending-codes` flag used only until S4K lands).
Gates: validate:data, test. Visible: a roster table per starter gang printed by `validate:data --print gangs`.

### S2 - Engine core: rounds, activation, movement, board actions (Sonnet; session review of activation.ts and movement.ts)

Files:
1. `src/engine/bundle.ts` (`bundleFromData`), 2. `nav.ts`, 3. `los.ts`, 4. `measure.ts`, 5. `state.ts` (helpers), 6. `dice.ts` (D3/D66 and tests), 7. `setup.ts` (createGame, roles, crews Custom/Random/Hybrid, zones, standard deployment, auto options), 8. `priority.ts`, 9. `activation.ts` (alternation, R-5.6, activate, group chain, menu, action economy, canTurn/turn, end; only implemented actions are offered: Move, Take Cover, Stand Up, Crawl, Reload, Operate Door, Access Terminal, Force Door, Crawl Through Ductway, Smash/Bypass/Carry casket, Turn, End), 10. `movement.ts`, 11. `zm.ts` (doors incl. closing on a fighter, terminals, force door, ductway crawl, caskets with the core contents table; the frag-trap result is wired in S3a), 12. `query.ts` (status, stat, actionMenu, losLine, inArc, cover, distance, pathDistance, engagedWith), 13. `index.ts`
14. `tools/sim-core.ts` (random bot over legal options and `suggest`; invariants: no NaN, wounds and Flesh Wounds in range, every on-board fighter inside the outline and overlapping nothing, at most 2 actions per activation, no Basic twice, Double only with 2 left, no voluntary move ending within 1" of a Standing/Pinned enemy, Engaged fighters Standing, Seriously Injured never Engaged, one pending decision with a legal answer, zero random-bot rejections, replay hash equal, every `DiceRolled` face legal), 15. `tools/sim.ts` (`--gangs real`, `--scenario`, `--rounds`), 16. `tools/board-svg.ts` (`--sim`)
17. `tests/fixtures/boards.ts` (open box, corridor with a door, barricade pair, ductway wall), 18. `tests/fixtures/helpers.ts`, 19. `tests/fixtures/real.ts`
20. `tests/engine/dice.test.ts` (DICE-001, 005; TEST-001..003), 21. `round.test.ts` (ROUND-001..005), 22. `act.test.ts` (ACT-001, 002, 004, 005), 23. `move.test.ts` (MOVE-001, 002), 24. `vis.test.ts` (VIS-001..005), 25. `zm.test.ts` (ZM-002..006, 008, 010, 011), 26. `sim.test.ts`, 27. `tests/data/bundle-adapter.test.ts`
Gates: common + sim 50 games Goliath vs Escher with `--rounds 4` (battles end by `roundLimit`), 0 violations. Visible: `board-svg --sim 1` with fighters, arcs and move paths after round 4.

### S2L - Client lab viewer (Sonnet, after S2, parallel with S3a)

Files:
1. `src/main.tsx` (renders the lab), 2. `src/client/lab/Lab.tsx` (board pick, door toggle, line-of-sight probe between two clicked points or fighters showing the engine's `losLine` and cover verdict, step-through of a seeded sim game), 3. `src/client/lab/driver.ts` (in-browser random driver: first legal option or `suggest`; never imports `src/ai`), 4. `src/client/lab/LabFighter.tsx` (base, procedural body, facing wedge, posture)
5. `src/client/board/ZmBoard.tsx` (REPLACE Terrain.tsx), 6. `floorTexture.ts`, 7. `wallTexture.ts` (ADAPT), 8. `CameraRig.tsx`, 9. `touchCamera.ts`, 10. `cameraApi.ts` (ADAPT)
11. `src/client/figures/Procedural.tsx` (KEEP, archetype list for Goliath/Escher stand-ins), 12. `src/client/ui/theme.ts` (KEEP)
13. `tests/client/zmBoard.test.ts` (one instanced mesh per wall material, door meshes per door, nothing outside the outline), 14. `tests/e2e/lab.spec.ts` (screenshot of each board and a mid-game state)
Gates: common + `npx playwright test tests/e2e/lab.spec.ts`. Visible: 3D screenshots of a 24 x 36 and a 7-tile board with fighters (also on Pages).

### S3a - Shooting and resolving hits (Sonnet; full session-model review)

Files:
1. `src/engine/dice.ts` (Firepower, Injury, Scatter faces from data; hit/wound/save/injury odds), 2. `shoot.ts`, 3. `hits.ts`, 4. `traits.ts` (Blast, Template, Rapid Fire, Knockback, Gas, Toxin, Flash, Smoke, Melta, Plentiful, Scarce, Single Shot, Limited, Unstable, Grenade, Scattershot, Shred, Rending, Blaze, Concussion, Sidearm, Unwieldy, Silent), 5. `wargear.ts`, 6. `casualties.ts`, 7. `movement.ts` (knockback push), 8. `zm.ts` (door targets, Fire Through Ductway, frag trap), 9. `activation.ts` (offer Shoot, Aim, Blind Fire, Fire Through Ductway), 10. `query.ts` (shootTargets, hitChance, woundChance, saveChance, injuryOdds, expectedOutcome, blastPreview, templatePreview)
11. `tests/fixtures/attack.ts`, 12. `tests/engine/shoot.test.ts` (SHOOT-001..011), 13. `blast.test.ts` (BLAST-001..006), 14. `inj.test.ts` (INJ-001..009), 15. `trait.test.ts` (TRAIT-001..005, 010, 011), 16. `zm.test.ts` (ZM-007, 009), 17. `dice.test.ts` (DICE-002..004)
Nerve tests caused here are queued on `state.nerve` and drained by a no-op until S3b (documented `TODO(S3b)`).
Gates: common + sim 50 `--rounds 6`. Visible: `board-svg --sim` with shot lines, blast markers and pinned/Seriously Injured fighters; a sim summary of casualties per game.

### S3b - Close combat, nerve and the remaining moves (Sonnet; full session-model review)

Files:
1. `src/engine/fight.ts` (incl. Coup de Grace action and free CdG), 2. `morale.ts` (nerve, Broken, Running for Cover with the four-criteria scoring, rally helper), 3. `movement.ts` (Charge path and D3, Retreat with reaction attacks, Running for Cover, Consolidate, Blaze random move, pushed-apart after involuntary moves), 4. `activation.ts` (Charge, Fight, Retreat, Coup de Grace, Broken -> Running for Cover only, Blaze activation, Blind), 5. `traits.ts` (Parry, Power, Shock, Disarm, Entangle, Versatile, Paired, Backstab, Pulverise, Sever), 6. `hits.ts` (Pulverise, Sever), 7. `apply.ts` (nerve drain after each step), 8. `query.ts` (chargeTargets with pReach, fightOutcome, nerveOdds)
9. `tests/engine/cc.test.ts` (CC-001..009), 10. `nerve.test.ts` (NERVE-001..005), 11. `move.test.ts` (MOVE-003..008), 12. `status.test.ts` (STATUS-001..006), 13. `act.test.ts` (ACT-003, 006, 007), 14. `trait.test.ts` (TRAIT-006..009)
Gates: common + sim 50 `--rounds 8`, 0 violations. Visible: sim summary (charges, fights, Broken fighters) and `board-svg` of a melee.

### S4 - End phase, scenarios, victory, full sim (Sonnet; session review of endphase.ts and scenarios.ts)

Files:
1. `src/engine/endphase.ts` (Bottle incl. voluntary, Fleeing with leading by example, Recovery with assist and pick, Rally, clean-up: smoke 1-4, Concussion), 2. `scenarios.ts` (crew-cap roll, casket placement step, tile deployment, Horrors in the Dark, scoring, locked win, victory, battle end), 3. `setup.ts` (casket and tile deployment steps), 4. `activation.ts` (voluntary flight at phase start), 5. `zm.ts` (scenario casket contents through code hooks), 6. `casualties.ts` (fled), 7. `query.ts` (bottleOdds, scenarioView), 8. `code-hooks.ts` (scenario hook registrations)
9. `tools/sim-core.ts` (full invariants: bottled never reverts, points never fall, fled = Out of Action, every game ends by scenario within 20 rounds and 4000 decisions, 200-decision stall detector), 10. `tools/sim.ts` (rotate all three scenarios and every board legal for each)
11. `tests/engine/end.test.ts` (END-001..009), 12. `scen.test.ts` (SCEN-001..008), 13. `round.test.ts` (ROUND-006, 007), 14. `golden.test.ts` (one forced-dice round of the starter gangs), 15. `code-hooks.test.ts`, 16. `sim.test.ts`, 17. `docs/spec/60-testing.md` (Necromunda version of the KT reference: gates, invariants, checklist coverage)
Gates: common + sim 50 games per scenario, no round limit, 0 violations, every game ends. Visible: sim report table (winner, rounds, bottle round, casualties) per scenario.

### S4K - Skills and house rules (Sonnet; full session-model review; parallel with S4)

Files:
1. `src/engine/skills.ts` (declarative effects of 20 section 7, skill actions, `skill.choice`, `dice.reroll` grants), 2. `src/engine/gangs/index.ts`, 3. `gangs/goliath.ts`, 4. `gangs/escher.ts` (code hooks named by S1G data), 5. `src/data/validate.ts` (drop `--allow-pending-codes`)
6. `tests/engine/skills.test.ts` (one test per declarative effect key), 7. `tests/engine/gangs-goliath.test.ts`, 8. `tests/engine/gangs-escher.test.ts` (each house hook fires in a real-gang fixture game)
Gates: common + validate:data without the flag. Visible: test list naming each skill and rule.

### S5a - Client core: store, presentation, battle shell (Sonnet; parallel with S6)

Files (moves of KEEP files listed in 1.4 included):
1. `src/main.tsx`, 2. `src/client/App.tsx`, 3. `params.ts`, 4. `store/game.ts`, 5. `store/session.ts`, 6. `store/saveGame.ts` + `testHooks.ts` (KEEP), 7. `game/adapter.ts`, 8. `game/defaults.ts`, 9. `game/labels.ts`, 10. `presentation/director.ts`, 11. `heldVolley.ts`, 12. `shotCamera.ts`, 13. `deployCamera.ts`, 14. presentation stores (KEEP, one move), 15. `bot/*` (KEEP/ADAPT), 16. `board/Board.tsx`, 17. `ui/BattleScreen.tsx`, 18. `ui/DecisionPrompt.tsx`, 19. `interaction/controller.ts`, 20. `interaction/Overlays.tsx`, 21. shared ui (KEEP, one move), 22. `docs/spec/50-client.md` (Necromunda version)
23. `tests/client/{store,presentation,prompts,params,saveGame}.test.ts`, 24. `tests/fixtures/presentation.ts`, 25. `tests/e2e/play.spec.ts` (deploy by clicks, move, open a door, shoot, end the round vs the random bot)
Gates: common + `play.spec`. Visible: battle screenshot on Pages (stand-in figures, ZM board, prompts, feed).

### S6 - AI re-scoring and bench (Sonnet; parallel with S5a)

Files:
1. `src/ai/{index,worker}.ts` (KEEP), 2. `tiers.ts`, 3. `decider.ts`, 4. `random.ts` (ADAPT), 5. `eval.ts`, 6. `threat.ts`, 7. `moves.ts`, 8. `shoot.ts`, 9. `fight.ts`, 10. `setup.ts` (REPLACE), 11. `end.ts`, 12. `skills.ts` (new)
13. `tools/ai-bench.ts`, 14. `tools/ai-match.ts`
15. `tests/ai/{decider,worker,tiers}.test.ts`, 16. `tests/ai/planner.test.ts`, 17. `tests/ai/fixtures.ts`, 18. `docs/spec/40-ai.md` (Necromunda version)
Gates: common + `npm run bench:ai -- --games 40 --pair gol,esc` normal >= 95% vs random, 0 rejections/stalls/fallbacks, activations with no action < 2%, decision p50 < 50 ms; `sim --decider normal --games 20` 0 violations. Visible: bench report.

### S5b - Figures, dice tray, sound, vfx, board overlays (Sonnet; parallel with S5c)

Files:
1. `src/client/figures/Fighter.tsx` (from Operative.tsx), 2. `cues.ts`, 3. `cueCore.ts`, 4. `attachmentFor.ts`, 5. `manifest.ts`, 6. `Gallery.tsx`, 7. `glbLoader.ts` + `hold.ts` (KEEP), 8. `dice/DiceTray.tsx`, 9. `dice/trayStore.ts`, 10. `audio/*` (KEEP) + 11. `audio/eventSounds.ts`, 12. `vfx/*` (KEEP) + 13. `vfx/families.ts`, 14. `src/vfxGallery.tsx` + `vfx.html` + `vite.config.ts` (vfx input back), 15. `weaponFlavour.ts`, 16. `gangs/{index,types,goliath,escher}.ts`, 17. `board/{Zones,Sightlines,MeasureLayer,Vfx}.tsx`, 18. `interaction/{sightData,sightStore,sightlines}.ts`
19. `tests/client/{figures,attachments,eventSounds,weaponFlavour,vfx,sightlines,heldVolley}.test.ts`, 20. `tests/e2e/{gallery,vfx,sightlines}.spec.ts`
Gates: common + those specs. Visible: a firefight screenshot with dice tray (Firepower and Injury faces), pinned and Seriously Injured figures, a blast marker.

### S5c - Screens, prompts, cards, end screen (Sonnet; parallel with S5b)

Files:
1. `ui/AttackPrompts.tsx`, 2. `ui/GamePrompts.tsx`, 3. `ui/Panels.tsx` (FighterCard), 4. `ui/Hud.tsx`, 5. `ui/StartScreen.tsx`, 6. `ui/GangPicker.tsx` (new), 7. `ui/Briefing.tsx`, 8. `ui/EndScreen.tsx`, 9. `ui/CasualtyTray.tsx`, 10. `ui/{TokenChips,tokenDefs,tokenInfo,markerInfo}`, 11. `ui/{SightlinePanel,MeasureTool}.tsx`, 12. `game/glossary.ts`, 13. `game/promptLabels.ts`, 14. `game/scenario.ts`, 15. `dev/scenarios.ts`
16. `tests/client/{glossary,labels,noNativeTooltips,rejections,markerInfo,activatePick,scenarios}.test.ts`, 17. `tests/e2e/{home,gang-picker,full-game,mobile-smoke,ui-consistency,start-options,save-game}.spec.ts`
Gates: common + every e2e spec, one full Playwright game to the end screen. Visible: gang picker, briefing, mid-battle and end-screen screenshots; this is the M3 "playable" build.

After S5c and S6: the main loop deletes `legacy/`, re-runs every gate, and pushes (M3 playable).

## 3. Risks

- **Rules density in S3a/S3b.** The shoot and fight sequences touch most traits and the nerve queue; they are split in two and reviewed on the session model against the checklist. A Sonnet implementer must not improvise traits outside R-14.3: unknown traits are refused at load (R-16.2).
- **Gang data is the long pole.** S1G needs `13-gangs.md`; skills that need code hooks are not runnable until S4K. The `--allow-pending-codes` flag keeps validate:data green meanwhile and is removed in S4K.
- **Geometry correctness.** Path distance, cover sampling and the 1" rule decide legality everywhere. `nav.ts` and `los.ts` get dedicated tests (DICE-005, VIS-*, ZM-*) and the S2L lab makes them visible early; the client draws from the same `BoardDef` and `losLine` data.
- **Battles that never end** before S4 (no bottle, no scenario end): sims use `--rounds` until S4 removes the cap.
- **Group activation and Running for Cover inside other activations** are the two places where control flow nests (a fighter breaks mid-attack and runs at once). Both are chains/queues in state, never recursion through `step`.
- **Client churn.** Moving the whole client to `legacy/` means no game on Pages between S1 and S5a; the S1 placeholder and the S2L lab keep Pages showing progress.
- **Edition switch.** If the owner moves to the 2026 edition, `core/*.json`, the rules modules and the gang data change; the contract, board, nav, los, presentation and client shells stay.
