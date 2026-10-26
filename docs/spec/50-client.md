# 50 - Client

React 19 + R3F 9 + drei 10 + zustand 5, `frameloop="demand"` (every async change calls `invalidate()`). The client never mutates `GameState` and never computes a rules number: odds, distances, route costs, cover verdicts and every "can this be done" answer come from `engine.query.*`, `engine.validate`, `pending.options[].data`, `pending.context` or the engine movement planner (`planToward` / `planMove`, read-only). Generic over houses (no house id literals outside `src/data/`). The Kill Team version of this file is kept in `kill-team-reference/50-client.md`.

## 1. Modules

```
src/main.tsx                                    routes: ?lab -> lab viewer (client/lab), everything else -> client/App
src/client/
  App.tsx, params.ts                            shell (quick setup -> battle), URL params
  store/game.ts                                 the ONLY caller of engine.step: state, pending, legal, events; bot seat loop + watchdog; autosave
  store/session.ts                              menu flow (screen, seats, scenario, board, starter gangs, seed, Continue card)
  store/saveGame.ts                             one save in localStorage (engine SaveFile + client envelope); never throws
  store/testHooks.ts                            window.__ms when ?test=1 (or ?debug)
  game/adapter.ts, defaults.ts, labels.ts       data -> GameSetup, scenario/board/gang lookups, text for events / options / rejections
  bot/randomBot.ts                              random-legal bot (ported from tools/sim-core.ts); the AI tiers of S6 replace it in the store loop
  presentation/                                 director (events -> timed beats), presentedStore (cursor + snapshots), idleStore, announceStore,
                                                feedStore, fxStore, animStore (move tween), settings, deployCamera, shotCamera, heldVolley (volley landings)
  board/                                        Board.tsx (battle canvas), ZmBoard (S2L), CameraRig + touchCamera + cameraApi, floor and wall textures
  figures/                                      BattleFighter (status cues), bodyManifest + glbLoader + Procedural (S2L); S5b replaces BattleFighter with Fighter
  interaction/                                  controller (pointer -> answers, engine verdicts), Overlays (3D layers for the pending decision)
  ui/                                           QuickSetup, BattleScreen, BattleHud, DecisionPrompt, EventFeed, FighterStrip, Tooltip, widgets, theme, uiStore,
                                                formFactor, hudLayout, BottomSheet, collapse, RotatePrompt
  lab/                                          the S2L lab viewer (?lab)
```

## 2. Screens and flow

Start screen and quick setup are one page (`QuickSetup`): scenario (the ones the engine cannot play yet are listed greyed out), board for that scenario, a starter gang per seat, who plays each seat (you or the random bot), a seed, Start. A saved battle on this device offers Continue. `?test=1` skips it. Battle: the board canvas, the HUD (scenario, round, phase, both gangs with standing / down / out counts and points, Priority holder, whose turn, the active fighter's action points, camera presets, log toggle, Menu), the event feed, the selected fighter's card, the decision prompt, banners and toasts. A plain result panel (winner, points, Rematch, Menu) appears when the battle is over and presented. S5c replaces the start flow with StartScreen, GangPicker and Briefing, the card with FighterCard and the result panel with the end screen.

## 3. Battle UI rules

- The store is the only caller of `step`. A human answer goes `dispatch -> step -> apply`; a rejection never changes anything and shows one error toast (a newer one replaces it), a bot seat's rejection is only logged.
- Presented-state cursor: the engine resolves a step instantly, the director plays its events as timed beats and only then advances `presentedSeq`. The board, HUD, card and feed read the DISPLAY state (`useDisplayState`, the last snapshot at or before the cursor); the prompt shows only when the cursor has caught up (`useSettled`). Nothing shows a result before its beat. A 6 s stall catch-up keeps a stuck director from freezing the UI.
- Bot seats wait for presentation idle, then pause 250 ms (scaled by the speed setting), then answer: the bot's guess, every legal action, the engine's `suggest`, a pass, and as a last resort a resignation. A watchdog answers if a bot decision sits unanswered for 5 s. `speed=instant` skips every pause, banner, effect and camera flight.
- Every prompt names what it decides (`decisionTitle`), says in one line how to answer (`decisionHelp`) and shows the engine's numbers beside each option (`optionFacts` from `option.data`: allowance, success chance, needed roll, range band, cover, distance, targets). Hovering an option highlights the fighter or door it names on the board. No native `title=` tooltips: the shared `Tooltip` is used (for the unavailable-actions list and the facing buttons).
- Finite decisions are option buttons from `pending.options` with labels from `optionLabel`; the generic list renders any kind the engine raises, so a new kind plays before it gets a custom body. `legalActions` also adds a pass when the decision allows one (Cancel for moves and shots).

## 4. Interactions by decision kind

| Kind | How the human answers |
|---|---|
| `setup.role`, `setup.zone`, `setup.crew` | option buttons (zone: far or near half of the screen) |
| `setup.deploy` | pick a fighter in the prompt or click one of yours, hover the highlighted strips (ghost base: green when the engine accepts the spot, red with its reason), click to place; Q / E or the arrows turn the facing; "Place the rest for me" uses `suggest` |
| `action.activate`, `action.group` | click a fighter on the board or a row in the list (rows show wounds and posture); group: add a fighter or "No more" |
| `action.choose` | grouped option buttons with allowance and odds; Turn is a free compass picker with "face an enemy" entries; door actions are also done by clicking the door on the board (one action: done; several: the panel puts them first); unavailable actions are listed with the engine's reason (`context.withheld`) behind a tooltip; End activation |
| `move.path` | hover the board: the engine's shortest legal route to the pointer, cut to the allowance (`planToward`), costed by `planMove`, drawn with "x of y inches, z left" and "stops short" when something limits it; click commits; Take Cover can stay put; Escape or right click cancels (no action spent) |
| `setup.casket`, `shoot.aim` | click the board (the engine validates the spot on hover), or the suggested aims |
| `shoot.*`, `fight.*`, `end.*`, `skill.choice`, `dice.reroll`, `confirm` | generic option list with engine labels and facts; targets also get a ring and a badge on the board; clicking the named fighter or door answers it |

## 5. Figures and status visuals

`BattleFighter` draws the lab's figure (`FighterBody`: the model manifest's GLB when it lists a body for the fighter, matched by house, type name and loadout weapons, else the procedural stand-in) at the engine position and facing. Status cues: Pinned lies face up, Seriously Injured lies face down (a tilt of the body), a coloured ring under the base for Pinned (yellow), Seriously Injured (red) and Broken (purple), a green ring while Ready in the Action phase, a gold ring on the active fighter, a white ring for choosable, selected and hovered fighters, a facing wedge for standing fighters only, and a tag with name, wounds, Flesh Wounds and the status word. A move plays as a tween along the engine's `FighterMoved` path while the display state still holds the old position.

## 6. Presentation beats (director)

Per event: feed line (`describeEvent`; bookkeeping events are silent), dice log entry for `DiceRolled`, banners for `RoundStarted`, `PriorityDecided` (with both rolls) and `GameEnded`, the move tween, wound override and an impact / floating text for damage, saves, pins and out-of-action, a door repaint. A step with `ShootStarted` plays a volley once its dice are shown: the shot camera behind the shooter (setting `cinematicShots`), one tracer per Firepower hit (at least one), impacts per landing (`planLandings`), a close-up when something got through. The deployment camera visits a bot's deployment while a human plays against it. Sound, the pooled vfx and the dice tray are S5b and hook into the same loop.

## 7. Test hooks and parameters

`?test=1&seats=human,bot&seed=<s>&gangs=gol,esc|starters=<id>,<id>&scenario=<id|slug>&board=<id|slug>&speed=instant|fast|normal` skips to the battle; `?ff=compact|desktop` forces the phone layout; `?lab` is the lab viewer; `?debug` installs the hooks without starting a game. `window.__ms`: `getState`, `getPending`, `display`, `legal`, `dispatch`, `choose`, `settled`, `suggestSpot`, `deployOk(x, z)`, `routeOk(x, z)`, `project`, `camera`, `session`, `ui`, `autoStep`, `toasts`, `events`. E2E picks `data-testid`s (`prompt` with `data-kind`, `opt-<option id>`, `deploy-<id>`, `deploy-auto`, `move-cancel`, `hud-round`, `event-feed`, `result`, ...).

## 8. Pages

Production base `/mancermundo/`; assets through `import.meta.env.BASE_URL`; chunks react / three / r3f / engine, the three.js chunks load only with the battle or the lab. First interactive page is the start screen (no 3D).

## 9. Known gaps (owners)

- S5b: figure cues (shoot, fight, go prone, stand up, fall), attachments by loadout, the dice tray with Firepower and Injury faces, sound, pooled vfx, board overlays for line of sight, templates, blasts and smoke, `Fighter.tsx`, the real body-to-fighter resolution (`matchBody` in `BattleFighter.tsx` is a heuristic).
- S5c: gang picker, briefing, full fighter card and weapon profile cards, end screen with casualties and points, glossary, scenario panel, casualty tray, the compact phone layout, the dev scenario fixtures (a shot at a real target, a fight, a door closing on a fighter).
- S6: the AI tiers in the store's bot loop (`bot/aiWorkerClient`, tier setting).
- Not done: `setup.crew` and `setup.casket` have no dedicated screens (the quick setup asks the engine to choose crews and casket spots: `autoCrew`, `autoCaskets`), Forgotten Riches is listed but greyed until the engine plays tile deployment, the camera does not yet avoid walls between the shot lens and the shooter.
