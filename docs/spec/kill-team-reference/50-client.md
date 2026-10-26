# 50 — Client

React 19 + R3F 9 + drei 10 + zustand 5, `frameloop="demand"` (every async change calls `invalidate()`). The client never mutates `GameState` and never computes a rules number: odds, cover/obscured verdicts, control, expected damage all come from `engine.query.*` or `pending.context`. Generic over teams (no team id literals outside `src/data/`). Copy from Mallet 42k and Fell-in wherever a file is listed in `docs/knowledge-base/README.md` as reusable; adapt names.

## 1. Modules
```
src/client/
  App.tsx, Scene.tsx, theme.ts, params.ts     shell, screens (start / team builder / battle / end), URL params
  store/game.ts                               the ONLY caller of engine.step; pending, legal, events, bot seat loop + watchdog
  store/testHooks.ts                          window.__ms (getState, dispatch, params) when ?test=1
  bot/                                        botDriver (acts only when presentation idle), aiWorkerClient, randomBot
  presentation/                               director (events -> timed beats), presentedStore (cursor), announceStore, idleStore, cueStore
  board/                                      Canvas, lights, CameraRig (+ touchCamera), Killzone mat 30x22, Terrain (GLB fit), Zones, Markers, Rings, Ruler, LosLines
  figures/                                    Operative (body + attachments + paint), Procedural stand-in, glbLoader (meshopt), Gallery (?gallery)
  interaction/                                per-decision controllers: deploy, move path (drag with increment preview, climb/drop markers), target picking with cover/obscured badges, fight resolve, marker actions; touch gestures
  dice/                                       dice tray (attack vs defence pools, crits highlighted, blocks animated), playRoll queue
  ui/                                         StartScreen, TeamBuilder (roster, loadout picker, equipment, legal-only), Hud (CP, VP, TP, initiative), ActivationBar (order, AP pips, action buttons), DecisionPrompt (what this decides + engine odds), OperativeCard, PloyPanel, MissionPanel/ObjectiveTracker, DiceLog, EventFeed, Briefing, HowToPlay, Settings (anim speed, volumes, low graphics), EndScreen, PainterPanel, Tooltip (no native title=)
  ui/formFactor.ts + BottomSheet, TouchActionBar, compactSheets, RotatePrompt   phone layout (copied from Mallet)
  audio/                                      manager, manifest, eventSounds, music director, trims
  vfx/                                        pooled FxEngine, weapon families, tracers, impacts, smoke
  weaponFlavour.ts                            weapon id -> flavour (bolter, slugga, flamer, plasma, rokkit, chain, crush, blade, bite), read by audio and vfx; a test fails on unclassified weapons
```

## 2. Screens and flow
Start → pick teams (human/AI/hot-seat per seat), mission (random/choice), layout, seed → Team builder (per seat: roster per team selection rules, per-operative loadout options from the datacard, equipment picks; invalid choices disabled with the reason; figure preview updates live) → Briefing (mission, crit op, kill op, controls) → Battle → End screen (VP breakdown by op, kill grades, replay/save).

## 3. Battle UI rules
- Every prompt names what it decides and shows the engine's numbers (hit odds, expected damage, cover/obscured, kill odds, AP left). Hovering an option highlights the exact operative/marker/terrain.
- Nothing shows a result before the presentation cursor reaches it (dice, wounds, VP, deaths, feed). Bot seats wait for idle; a 6 s stall catch-up prevents a stuck UI; `instant` speed skips pauses.
- Activation bar: order toggle (with the Conceal consequences explained), AP pips, action buttons with AP cost and disabled reasons, End activation. Move: drag or tap-to-move with straight-line increments drawn and rounded-up distance shown; climb/drop/jump segments labelled; invalid end positions explained.
- Shooting: target candidates badged (valid / in cover / obscured / not visible with reason); dice tray shows attack and defence pools side by side with blocks animated; the defender's block prompt offers `auto` first.
- Fight: alternating strike/block prompt with the remaining dice of both sides and the damage each choice inflicts/prevents.
- Mission panel: crit op status, markers controlled/contested with APL totals, kill grades, VP by source, turning point and initiative.

## 4. Test hooks
`?test=1&seats=human,bot&seed=<s>&mission=<id>&layout=<id>&teams=aod,kom&tier=normal&speed=instant` skips to the battle with default rosters; `?gallery`, `?fps`, `?ff=compact|desktop`, `?scenario=<name>` (fixtures in `client/dev/scenarios.ts`). `window.__ms` exposes `getState()`, `getPending()`, `legal()`, `dispatch(action)`, `camera`. E2E picks exact text and `data-testid`s.

## 5. Pages
Production base `/mancermundo/`; assets via `import.meta.env.BASE_URL`; chunks react/three/r3f/engine; first interactive < 3 s.
