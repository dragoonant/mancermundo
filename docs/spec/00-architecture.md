# 00 - Architecture

Source of truth for module boundaries, the engine contract, the decision model, determinism, space and fighter state of Mancermundo. Rules content lives in `10-rules-core.md` (R-x.y), `11-scenarios.md` (M-x.y) and `13-gangs.md`; data shapes in `20-data-schema.md`; the conversion plan from the copied Kill Team code in `05-migration.md`; the Kill Team contracts it replaces are kept for reference in `kill-team-reference/`. `src/engine/types.ts` is the code form of sections 3 to 7 and must not diverge from this file. Contracts are **frozen after M2**; later changes are additive and get a dated row in section 11.

Lineage: Murder Squad's engine contract (pure reducer, one `PendingDecision` at a time, events, seeded RNG, replay, `view`, namespace-owner modules, code-hook escape hatches) is kept unchanged in shape. What changes is everything Kill Team specific: no APL, orders, CP, ploys, Guard, counteract, defence dice or turning points. Necromunda brings rounds with Priority / Action / End phases, two actions of typed cost per activation, group activation, facing and a vision arc, the hit / wound / save / Injury dice chain, pinning, nerve and bottle, and a flat Zone Mortalis board of walls and doors.

Edition neutrality (cheap only): the action catalogue (ids, Simple/Basic/Double/Free, which statuses may take them), the special dice faces and the rule constants (nerve radius, group radius, leading-by-example radii, crew-cap tables) are data (`src/data/core/`), statuses and conditions are open string unions, characteristics are a keyed record, and `GameSetup.ruleset` names the edition (`'n23'` only in v1). A later switch to the 2026 Necromunda Skirmish edition replaces the rules modules and core data, not the contract.

## 1. Modules

| Module | Path | May import | Must not | Runtime |
|---|---|---|---|---|
| engine | `src/engine/` | nothing outside itself (+ type-only `src/data/types`) | DOM, React, Three, timers, `Math.random`, `Date` | node + browser + worker |
| data | `src/data/` | schemas only | code with side effects | build-time JSON, validated by `tools/validate-data.ts` |
| ai | `src/ai/` | engine (read-only API), data | client, Three | node + worker |
| client | `src/client/` | engine, ai, data | mutate `GameState`, compute a rules number | browser |
| tools | `tools/` | anything (node) | be imported by src | node |
| tests | `tests/` | everything | - | vitest / playwright |
| legacy | `legacy/` | - | be imported by anything | not compiled (outside `tsconfig` include and vitest include); deleted after S6 |

Dependency direction `data <- engine <- ai <- client`, enforced by `tests/engine/boundaries.test.ts` (greps imports, also refuses any import of `legacy/`). Path alias `@/` -> `src/`.

### Engine files

```
src/engine/
  -- contract (frozen after M2) --
  types.ts       contract types (sections 3-7)
  actions.ts     Action constructors (act.*) over the payload map in types.ts
  events.ts      GameEvent union (section 5)
  hooks.ts       hook names, contexts, results; registerHook/runHook; window opener; frame resumes
  rng.ts         seeded xoshiro128** + ScriptedRng + sha256/fnv1a           (kept verbatim from Murder Squad)
  decider.ts     Decider interface + ReplayDecider                            (kept verbatim)
  view.ts        per-seat PlayerView (strips rng and log; N23 hides nothing else)
  index.ts       createGame / step / legalActions / validate / replay / view / save / load / undo / suggest
  -- plumbing --
  registry.ts    ModuleDef, Ctx (emit, roll, raise), reject, stubModule       (kept; Ctx.roll gains a die kind)
  apply.ts       envelope checks -> owner of pending.kind -> afterAction (engagement refresh, nerve queue) -> log + hash
  modules.ts     namespace -> module table (exactly one owner per namespace)
  state.ts       fighter/seat helpers, immutable clone, canonical hash, EngineInvariantError
  bundle.ts      EngineBundle + bundleFromData (gang/weapon/trait/skill/wargear/board/scenario records -> runtime shapes)
  code-hooks.ts  registry of `{ "code": "<name>" }` escape hatches; fire counts for tests
  effects.ts     timed effects (until end of activation / round / battle) and their expiry
  -- space --
  geometry.ts    pure 2D: segments, polygons, circles, intervals                 (kept)
  footprint.ts   round-base footprints and gaps (ovals unused but harmless)       (kept)
  board.ts       compile a Zone Mortalis board (tiles + rotation) into BoardDef: wall/door/obstacle polygons,
                 ducts, terminals, casket spots, tile rectangles, deployment regions; dynamic door state
  nav.ts         shortest legal routes and path distances (visibility graph over inflated corners, cached per
                 door state and radius; optional avoid discs for the 1" rule); used by movement, proximity, AI
  los.ts         2D line of sight (walls, closed doors, smoke), vision arc, cover verdict (R-4)
  measure.ts     base-edge straight distance (range), path proximity "within X" (R-1.9), contact and engagement
  -- rules modules (namespace owners) --
  setup.ts       SET  setup.*     roles, crew selection, casket placement, deployment tile/half, deployment
  priority.ts    PRI  priority.*  roll-off with the tie rule, Ready all (no v1 decisions; namespace reserved)
  activation.ts  ACT  action.*    turn alternation, activate, group activation, action menu by status, action
                                  economy (Simple/Basic/Double/Free), voluntary flight, Broken/Blaze activations
  movement.ts    MOV  move.*      Move, Take Cover, Crawl, Retreat, Consolidate, Carry; engine-made paths for Charge,
                                  Running for Cover, Knockback, Blaze, door push, Retreat fallback
  shoot.ts       SHT  shoot.*     Shoot / Blind Fire / Fire Through Ductway: weapon, target priority, range, hit roll,
                                  stray shots, Blast scatter, Template, Rapid Fire allocation, Firepower and Ammo, pinning
  fight.ts       FGT  fight.*     Fight: turn to face, weapons, attack dice, split, hit rolls, assists/interference,
                                  Parry, reaction attacks, consolidate or Coup de Grace (and the Coup de Grace action)
  hits.ts        (no namespace)   resolve one hit: wound roll, save, Damage, Injury dice, Flesh Wounds, Seriously
                                  Injured, Out of Action; Gas/Toxin/Flash paths; door targets; casualty log entries
  traits.ts      (no namespace)   every weapon trait as handlers on hook points (Backstab ... Versatile); unimplemented
                                  traits refuse the weapon at load (R-16.2)
  wargear.ts     (no namespace)   armour saves (one item provides the save), wargear effects, grenade bookkeeping
  morale.ts      (no namespace)   nerve tests queue, Broken, Running for Cover end-point scoring, Rally helper
  endphase.ts    END  end.*       Bottle, Fleeing (leading by example), Recovery (assist, pick), Rally, clean-up,
                                  battle-end check hand-off to scenarios
  zm.ts          (no namespace)   Zone Mortalis actions offered through action.choose: Operate/Force Door, Access
                                  Terminal, Crawl/Fire Through Ductway, casket Smash/Bypass/Carry, ammo cache; door hits
  scenarios.ts   SCN  scenario.*  scenario set-up steps, Horrors in the Dark, scoring, locked wins, victory, GameEnded
  skills.ts      SKL  skill.*     skills, fighter rules and house rules from data (declarative effects + code hooks);
                                  `skill.choice`; `dice.reroll` grants routed here (modules.ts override)
  casualties.ts  (no namespace)   casualty log: who put whom Seriously Injured / Out of Action / fled, and how
  dice.ts        (no namespace)   D6/D3/D66, Firepower/Injury/Scatter faces from data, exact odds tables
  query.ts       (no namespace)   every number the UI or AI shows (section 7.6)
  gangs/index.ts imports each house's code-hook file once (goliath.ts, escher.ts); house code lives only there
```

## 2. Engine contract (unchanged functions)

```ts
step(state: GameState, action: Action, rng?: Rng): StepResult
interface StepResult {
  state: GameState;                 // new state, or the SAME reference when rejected
  events: GameEvent[];              // ordered; [ActionRejected] when rejected
  pending: PendingDecision | null;  // null only when state.phase === 'ended'
  rejection?: Rejection;
}
```

| Function | Purpose |
|---|---|
| `createGame(setup: GameSetup, seed: string, bundle: EngineBundle): StepResult` | validates the setup (house and fighter-type ids, starter-gang or roster legality per `13-gangs.md`, weapon/wargear/skill ids, scenario and board ids, board legal for the scenario), compiles the board, builds the state, raises the first decision. Throws `EngineInvariantError` on an invalid setup (setups come from the gang picker or the sim, never a Decider). |
| `step(state, action, rng?)` | pure reducer; never throws on illegal input; throws only on corrupt state. |
| `legalActions(state, pending): Action[] \| null` | enumerated answers for finite decisions; `null` for continuous ones (`move.path`, `setup.deploy`, `setup.casket`, `shoot.aim`). **Never empty for an open finite decision.** Every member passes `validate`. |
| `validate(state, action): Rejection \| null` | the same checks `step` runs, no mutation. |
| `replay(setup, seed, actions, bundle)` | folds `step` from `createGame`; returns `hashes` and `failedAt`. |
| `view(state, seat): PlayerView` | strips `rng` and `log`; N23 skirmish has no hidden information. Deciders only see a `PlayerView`. |
| `suggest(state, pending): Action \| null` | engine default for a decision (deploy spot, casket spot, aim point, best legal path toward a point); used by auto options, the random bot and the AI fallback. Replaces Kill Team's `suggestPlacement` / `answerDecision`. |
| `save / load / undo` | `SaveFile { version, engineVersion, setup, seed, actions, finalHash }`; undo vs AI only for actions that rolled no dice. |

Reducer rules: state is immutable (structural copies); no I/O, clock or `Math.random` (only the `Rng` restored from `state.rng`); one action -> zero or more events -> exactly one new `pending`; every rule effect emits an event and the client rebuilds everything it shows from events + state. Dice the rules roll with no choice involved (priority roll-off, Ammo tests, nerve, Injury dice, scatter, recovery) are rolled inside the step; they are never a decision of their own.

## 3. Decision model

```ts
interface PendingDecision {
  id: string;                  // "d:<n>" monotonic
  seat: Seat;                  // 'A' | 'B'
  kind: DecisionKind;          // "<namespace>.<verb>"
  window: TimingWindowId;      // section 4
  context: Record<string, unknown>; // ids and engine numbers for this choice (odds, needs, distances, suggestions)
  options?: DecisionOption[];  // finite answers, each a ready-made Action with a label key and data
  constraints?: MoveConstraints; // continuous answers
  canPass: boolean;
}
```

| DecisionKind | Seat | Payload / notes |
|---|---|---|
| `setup.role` | roll-off winner | `{ choice: 'attacker' \| 'defender' }` in scenarios with roles; `{ choice: 'first' \| 'second' }` (who deploys first and picks the half) otherwise. The roll-off itself is automatic. |
| `setup.crew` | each seat in turn (defender first when roles exist) | one fighter per answer `{ fighterId }` for the Custom part, or `{ done: true }` once at least one is picked; capped at the scenario's X. Random parts are drawn by the engine (`CrewChosen`). Forgotten Riches rolls its 2D6 cap first. `GameSetup.options.autoCrew` skips it. |
| `setup.casket` | placer (scenario) | continuous `{ x, z }` within `constraints.region`, spacing and edge rules; `context.suggestion` holds the engine spot. Skipped with `autoCaskets`. |
| `setup.zone` | deploy-first seat, then the other | standard deployment: `{ zoneId }` (one of the two halves); Forgotten Riches: a casket-free tile. Second seat gets the remaining choice set. |
| `setup.deploy` | deploying seat (whole crew, then the other seat) | continuous `{ fighterId, x, z, facing }` inside `constraints.region`, not overlapping walls, obstacles or bases. Fighters set up Standing. |
| `action.flee` | a bottled seat at the start of the Action phase | voluntary flight (R-13.4): `{ fighterId }` or `{ done: true }`. Only raised when the seat is bottled and has an eligible fighter. |
| `action.activate` | seat on turn | `{ fighterId }` of a Ready fighter. While a group is in progress the options are only the group's members. When the opponent has no Ready fighters the same seat keeps answering (R-5.6). |
| `action.group` | activating seat | nominate one more Ready friend within the group radius (path distance) `{ fighterId }`, or `{ done: true }`; repeats up to X (R-5.5). Raised only when X > 0 and a candidate exists. |
| `action.choose` | active fighter's seat | next action: `{ action, targetId?, weaponId?, doorId?, ductId?, casketId?, terminalId?, spot?, facing? }` or `{ action: 'end' }`. Options are filtered by status, actions left, Basic/Free repeat rules and conditions; each option carries the engine numbers (`data.odds`, `data.reach`, `data.disabled` is never used: illegal actions are absent). `turn` (free facing change) is offered while `activation.canTurn`, as 8 compass facings plus "face <enemy>" options. Door, terminal, ductway and casket actions are options here (there are no `door.*` decisions). |
| `move.path` | mover's seat | continuous `{ waypoints: Waypoint[], facing? }`; `constraints.kind` = `move` \| `takeCover` \| `crawl` \| `retreat` \| `consolidate` \| `carry` with `maxInches` and the 1" rule mode. `pass` cancels the action before anything was rolled (no action spent). Charge, Running for Cover, Knockback, Blaze and door pushes never ask: the engine makes the path. |
| `shoot.weapon` | shooter | `{ weaponId, profileId, twinWith? }` (two sidearms together, R-8.10). Skipped when only one usable option exists. |
| `shoot.target` | shooter | `{ targetId }` for an eligible enemy, `{ doorId }` for a closed door, or `{ point: true }` (Blast/Smoke at a floor point, then `shoot.aim`). Each option's data: distance, range band, cover, final hit need, chance, and `priority: 'closest' \| 'free' \| 'coolTest'`. A failed priority Cool test redirects to the closest target in the step (no new decision). |
| `shoot.aim` | shooter | continuous `{ x, z }`: Blast centre at a floor point, or the Template direction; `context.suggestions` lists engine aims with the fighters each would hit. |
| `shoot.allocate` | shooter | Rapid Fire extra hits: one answer per extra hit `{ targetId }` among the original target and eligible enemies within 3" not harder to hit (R-14.3). Skipped when the original target is the only option. |
| `fight.weapons` | attacker; then each reacting fighter's seat | weapon combination `{ weaponIds: string[] }` (one or two Melee/Sidearm weapons, one Unwieldy weapon, or `[]` unarmed). Skipped when only one combination exists. |
| `fight.split` | attacker | how the attack dice go between engaged targets in arc, `{ split: Record<targetId, number> }` (enumerated, at most a few dozen options). Skipped with one target. |
| `fight.after` | attacker | after the attack if every engaged enemy is down (R-10.10): `{ choice: 'coupDeGrace', targetId }`, `{ choice: 'consolidate' }` (then `move.path` kind `consolidate`, 2") or `{ choice: 'none' }`. Also used for the free Coup de Grace after a Charge that ends near a Seriously Injured enemy (R-7.6). |
| `end.bottle` | each seat that must test, Priority player first | `{ choice: 'test' \| 'bottle' }` (voluntary failure, R-13.1). |
| `end.assist` | seat with a Seriously Injured fighter that has an eligible assister | `{ assisterId, recoveringId }` or `{ none: true }`; each assister once per End phase (R-13.6). |
| `end.recoveryPick` | owner of an assisted fighter | which of the rolled Injury dice applies `{ index }`. |
| `skill.choice` | any | enumerated choice raised by a skill, fighter rule or house rule; `context.code` names the hook. |
| `dice.reroll` | roller | a re-roll a skill or wargear grants: `{ grantId, dieIndexes }` or `pass`. Opened only when a usable grant exists (no v1 core rule opens it). |
| `confirm` | any | acknowledge; `{ choice: 'continue' \| 'concede' }` after a locked Smash & Grab win, and the battle end. |

No decision exists for: priority rolls, Ammo tests and Reload rolls, target-priority Cool tests, stray shots, scatter, Injury dice, nerve, flee and rally tests, closing a door on a fighter (the engine moves it, ruling logged in S2), Blast hit order (engine resolves nearest-to-centre first; ruling to log in S3). `shoot.ammo` is not a decision kind: Out of Ammo is a weapon state and Reload is an action.

### Decider
```ts
interface Decider { decide(view: PlayerView, pending: PendingDecision, legal: Action[] | null): Promise<Action>; cancel?(): void }
```
Human UI, AI, random bot and replay implement the same interface. The game loop (client store or `tools/sim-core.ts`) is the only caller of `step`.

## 4. Timing windows

`TimingWindowId` is shared by engine, data (skill `window`), AI and UI. Windows name where a decision sits and where lifecycle hooks run; skills and house rules attach to them. There are no ploys in v1, so a window opens a decision only when a skill or rule of the seat can actually act there.

`setup.*` (all set-up decisions), `round.start` (before the priority roll), `priority.decided` (after the roll-off, before Ready), `action.phaseStart` (voluntary flight; first activation), `activation.start` (fighter activated, before its first action), `activation.groupNominated`, `action.declared` (before an action resolves), `move.ended`, `action.resolved`, `shoot.targetDeclared` (target and modifiers known, before the hit roll), `shoot.hitRolled` (after the hit roll, before stray shots, scatter and pinning), `shoot.firepowerRolled` (Rapid Fire hits and Ammo symbols known), `shoot.resolved`, `fight.weaponsChosen`, `fight.hitRolled` (after hit rolls, before Parry), `fight.resolved` (after the attacker's hits), `fight.reactions` (each reacting fighter), `hit.woundRolled`, `hit.saveRolled`, `hit.damage`, `injury.rolled` (Injury dice on the table, before they apply), `fighter.seriouslyInjured`, `fighter.outOfAction`, `nerve.test`, `activation.end`, `end.bottle`, `end.flee`, `end.recovery`, `end.rally`, `round.end`, `battle.end`.

Order when both seats could act in the same window: the active seat first, then the opponent; outside activations, the Priority player first.

## 5. Actions and events

Action envelope `{ type, seat, decisionId, seq, payload }`; `type` strings are the DecisionKind answers plus `pass` and `resign`. `seq` is assigned on accept. `act.*` constructors in `actions.ts` build every envelope (no hand-built envelopes in client, AI or tests).

Action ids inside `action.choose` come from `src/data/core/actions.json` (`move`, `charge`, `shoot`, `aim`, `takeCover`, `reload`, `coupDeGrace`, `operateDoor`, `accessTerminal`, `forceDoor`, `crawlDuct`, `fireDuct`, `smashCasket`, `bypassCasket`, `carryCasket`, `fight`, `retreat`, `standUp`, `crawl`, `blindFire`, `runForCover`, `turn`, `end`); skills add their own ids (`skill:<id>`).

Event families (all carry `seq`, `round`, `phase`, `seat`):

- game: `GameCreated`, `RoundStarted`, `RoundEnded`, `PhaseStarted`, `PhaseEnded`, `PriorityDecided { holder, rolls, tieRule }`, `GameEnded { result }`.
- setup: `RoleChosen`, `CrewCapRolled`, `CrewChosen { fighterIds, random }`, `CasketPlaced`, `ZoneChosen`, `FighterDeployed { fighterId, pos, facing }`.
- activation: `FightersReadied { fighterIds }`, `FighterActivated { fighterId, group? }`, `GroupNominated { leaderId, fighterIds }`, `FighterTurned { fighterId, from, to, free }`, `ActionDeclared { fighterId, action, type }`, `ActionResolved`, `ActionCancelled`, `ActivationEnded { fighterId, actionsUsed }`, `FighterFled { fighterId, voluntary }`.
- movement: `FighterMoved { fighterId, kind, from, to, path, length, maxInches }` with `kind` = `move` \| `charge` \| `takeCover` \| `crawl` \| `retreat` \| `consolidate` \| `carry` \| `runForCover` \| `knockback` \| `blaze` \| `doorPush` \| `duct` \| `pushedApart`.
- status: `StatusChanged { fighterId, from, to, reason }` (posture), `ConditionChanged { fighterId, condition, on, reason }`, `EngagementChanged { fighterId, engagedWith }`, `FleshWound { fighterId, total, toughness }`, `FighterOutOfAction { fighterId, by, cause }`.
- shooting: `ShootStarted { fighterId, weaponId, profileId, mode }`, `TargetDeclared { targetId \| doorId \| point, distance, band, cover, need, modifiers }`, `PriorityTest`, `HitRolled { dice, need, hit, improbable? }`, `StrayShot { candidateId, roll, hit }`, `BlastPlaced { centre, radius }`, `BlastScattered { from, to, distance, direction, misfire? }`, `TemplatePlaced { polygon }`, `FirepowerRolled { faces, hits, ammoSymbols }`, `AmmoTest { weaponId, roll, need, passed, result }`, `WeaponStateChanged { fighterId, weaponId, ammo }`, `FighterPinned`, `ShootEnded`.
- hits: `WoundRolled { targetId, roll, need, wounded, auto? }`, `SaveRolled { targetId, roll, need, saved, item }`, `DamageInflicted { targetId, amount, wounds }`, `InjuryRolled { targetId, faces, applied }`, `KnockedBack`, `CaughtFire`.
- fight: `FightStarted { attackerId, targets, weapons, dice, charge }`, `AttackDiceSplit`, `FightHitRolled { weaponId, targetId, dice, need, modifiers }`, `Parried { by, rerolled }`, `ReactionStarted { fighterId }`, `CoupDeGrace { fighterId, targetId }`, `Consolidated`.
- morale: `NerveTest { fighterId, roll, need, passed }`, `RunningForCover`, `BottleTest { seat, roll, down, crew, bottled, voluntary }`, `FleeTest`, `RecoveryTest { fighterId, faces, applied, assistedBy? }`, `RallyTest`.
- board: `DoorChanged { doorId, state, locked }`, `DoorDamaged { doorId, wounds }`, `TerminalAccessed`, `DuctUsed`, `CasketOpened { casketId, by, roll, result }`, `CasketMoved`, `SmokePlaced`, `SmokeCleared`.
- scenario: `HorrorsInTheDark { fighterId, roll, result }`, `PointsScored { seat, amount, reason }`, `CasketSecured`, `ResultLocked { winner, reason }`.
- dice: `DiceRolled { purpose, die: 'd6' \| 'd3' \| '2d6' \| 'firepower' \| 'injury' \| 'scatter', dice, faces?, final }` for every physical roll (the tray renders `die`).
- meta: `ActionRejected`, `DecisionRequested`.

## 6. Determinism, log, replay

`Rng` = xoshiro128** seeded from `sha256(seed)`; `state.rng` is authoritative (restored at the start of `step`, serialised back). Every roll goes through `ctx.roll(purpose, n, die)` and emits `DiceRolled`; special dice are D6 results mapped through the face tables in `core/dice.json`; the scatter direction is `rng.int(360)` degrees (one draw, emitted as a `scatter` die). `state.log: Action[]` is append-only; `state.hash` = fnv1a of canonical state minus log, recomputed per step; `replay` reproduces the hash at every seq (the sim asserts it). `ScriptedRng` feeds exact D6 values for checklist tests (one value per D6, and per scatter direction a value in 0..359). `ENGINE_VERSION` starts at 0.1.0 (M0) and becomes 1.0.0 at the M2 freeze.

## 7. Space and fighters

### 7.1 Board and coordinates

| Item | Definition |
|---|---|
| Units | 1.0 = 1 inch; base mm converted once at load (`mm / 25.4`). Precision 1/1000 inch; movement is measured exactly (no Kill Team rounding up). |
| Axes | Y up, board plane XZ, right-handed; figure front = +Z at facing 0; facing in radians, clockwise seen from above. `pos` is a `Vec3` with `y = 0` on the flat v1 board (kept for a later Sector Mechanicus). |
| Default board | 2 x 3 tiles of 12" = 24" x 36": x in [-12, 12], z in [-18, 18]. The long axis is z; seat A's short edge is z = -18 by default (the deploying seat's choice can swap halves). |
| 7-tile board | Forgotten Riches "brick": centre row of three tiles x in [-18, 18], z in [-6, 6]; two tiles above at z in [6, 18] and two below at z in [-18, -6], each row spanning x in [-12, 12]. Bounding box 36 x 36; the playable area is the union of tile squares. |
| Tiles | 12" squares placed by centre and a quarter-turn rotation; tile-local coordinates are in [-6, 6]. The board outline (union of tiles) is the outer wall. |
| Walls | data segments `{ a, b, thickness }` (default 0.5"), compiled to rectangles (`BoardDef.walls: Polygon[]`). Impassable, block line of sight, block proximity measuring (path distance), never climbable. |
| Doors | a segment in a wall gap, compiled to a rectangle with dynamic state `closed` \| `open` \| `destroyed`, `locked` (terminals on each side within 1"), `wounds` (T5, 4 W, no save). Closed = a wall; open or destroyed = a gap. A fighter "in the doorway" is one whose base overlaps the door rectangle. All doors start closed. |
| Ductways | two end points on opposite sides of a wall (length up to 2"); no geometry of their own. |
| Obstacles | polygons with `kind` (`barricade`, `crates`, `barrels`, `pipes`); nominal height 1": crossing costs +1", cannot end on one, never block line of sight, give cover; a barricade makes two fighters touching opposite sides within 1" of each other Engaged (R-15.10). |
| Caskets / caches | discs of 1" diameter (`pos`, `state`, `carriedBy`); not obstacles for movement; may not overlap a base at placement. |
| Smoke | discs of 2.5" radius; block line of sight into, out of and through; not movement. |
| Deployment regions | per scenario: standard = the strip of each half at least 12" from the dividing line (z <= -6 or z >= 6 on 24 x 36); tile deployment = within 3" of the chosen tile's outer board edge. |

```ts
// types.ts (contract); src/engine/board.ts compiles data boards into it
interface BoardDef {
  id: string; layout: '2x3' | 'brick7'
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  tiles: { id: string; tileId: string; centre: Vec2; rot: 0 | 90 | 180 | 270; rect: Polygon; floor: string }[]
  outline: Polygon[]                                   // tile squares; their union is the playable area
  walls: { id: string; seg: Segment2; thickness: number; poly: Polygon }[]   // outline walls included
  doors: { id: string; seg: Segment2; poly: Polygon; lockedAtStart: boolean; terminals: { id: string; pos: Vec2 }[] }[]
  ducts: { id: string; a: Vec2; b: Vec2 }[]
  obstacles: { id: string; kind: string; poly: Polygon }[]
  casketSpots: Vec2[]
  props: { model: string; pos: Vec2; yaw: number }[]   // decoration only, never rules geometry
}
interface BoardState {
  def: BoardDef
  doors: Record<string, { state: 'closed' | 'open' | 'destroyed'; locked: boolean; wounds: number }>
  caskets: Record<string, { pos: Vec2; state: 'closed' | 'opened' | 'ammoCache' | 'exhausted' | 'removed'; carriedBy: string | null; openedBy?: Seat }>
  smoke: { id: string; pos: Vec2; radius: number; placedRound: number }[]
}
```

### 7.2 Measuring, contact and engagement

- Range (weapons, blasts, templates): straight base-edge distance (closest points of the two bases); line of sight is checked separately (R-1.9 ruling).
- Proximity "within X" (nerve 3", group 3", leading by example 12"/6", assist 1", Horrors 8"): shortest path between bases that crosses no wall and no closed door, from `nav.pathDistance` (base-edge = centre path length minus both radii).
- Base contact: base-edge gap <= `CONTACT_EPS` = 0.02". Engine-made moves that end "in base contact" place the base at gap 0.
- Engaged (derived, never stored as a source of truth): a Standing fighter in base contact with a Standing enemy, or across a barricade (R-15.10). Pinned enemies stand up when contacted by a charge (R-3.4); Seriously Injured fighters are never Engaged. `apply.afterAction` recomputes engagement and emits `EngagementChanged`; the derived list is cached on the fighter as `engagedWith` for the view and the hash. Versatile engagement exists only inside the attack that uses it (`AttackState.versatile`).
- The 1" rule (R-7.3): a voluntary move may not come within 1" of a Standing or Pinned enemy (Charge excepted); checked along the path every 0.25" and at the end.

### 7.3 Line of sight, vision arc and cover (R-4)

- Line of sight: from the attacker's base centre to any of 17 sample points of the target base (centre + 16 on the rim) along a segment that crosses no wall rectangle, no closed door rectangle and no smoke disc. Fighters and obstacles never block it.
- Vision arc: 90 degree wedge centred on the facing; a target is inside if any part of its base is (ruling). Prone fighters have no arc; Blind Fire uses 360 degrees.
- Cover verdict (from the attacker, or from the blast centre / template origin): 9 sample points across the target base diameter perpendicular to the line of fire; a sample line is blocked by a wall, closed door, smoke, an obstacle farther than 1" from the attacker, or another Standing fighter's base (friends in base contact with the attacker and the target itself ignored; Prone bases never block). All clear = none; at least half clear = partial; fewer than half = full. A Prone fighter in partial or full cover cannot be targeted by ranged attacks.
- `query.losLine(state, fromId, toId)` returns the sample lines and blockers so the client draws exactly what the engine judged.

### 7.4 Fighter state

```ts
type Posture = 'standing' | 'pinned' | 'seriouslyInjured'          // open union (edition-neutral)
type Location = 'reserve' | 'board' | 'outOfAction' | 'fled'
type StatKey = 'M' | 'WS' | 'BS' | 'S' | 'T' | 'W' | 'I' | 'A' | 'Ld' | 'Cl' | 'Wil' | 'Int'
type AmmoState = 'ok' | 'out' | 'jammed' | 'spent'                  // spent = Single Shot / Scarce / grenade used up

interface FighterWeapon {
  weaponId: string
  ammo: AmmoState                  // applies to every profile of the weapon (R-8.9)
  lostProfiles: string[]           // Limited profiles gone for the battle (R-14.3)
}

interface Fighter {
  id: string; seat: Seat; typeId: string; name: string
  role: string                     // 'leader' | 'champion' | 'ganger' | 'juve' | 'specialist' | ... (from data)
  location: Location
  pos: Vec3; facing: number; baseRadius: number
  posture: Posture
  stats: Record<StatKey, number>   // printed profile; target numbers stored as the number before '+' (BS 4+ -> 4)
  wounds: number; maxWounds: number
  fleshWounds: number              // each is -1 T for the battle; T 0 = Out of Action
  ready: boolean
  conditions: Record<string, ConditionState>  // broken, blind, concussion, blaze, insane, ammoCache ... (open set)
  weapons: FighterWeapon[]; wargear: string[]; skills: string[]
  rules: { id: string; x?: number }[]          // fighter rules: groupActivation(x), leadingByExample ...
  engagedWith: string[]            // derived cache (7.2)
  carrying: string | null          // casket id
  activatedThisRound: boolean      // Blind: "already activated" check
  downedBy?: { by: string | null; cause: string }   // for scoring and the end screen
}
interface ConditionState { since: number; source?: string; data?: Record<string, unknown> }
```

Status as the rules name it is a pure function of the state (`query.status(state, id)`): `standingActive`, `standingEngaged`, `pinned`, `seriouslyInjured`, `outOfAction`. Effective characteristics come from `query.stat(state, id, key)`: printed value, Flesh Wounds on T, Concussion on I (never worse than 6+), then `stat.modify` hooks. The action menu is keyed by the derived status, plus `broken` overriding it (R-6.3).

### 7.5 Game state (top level)

```ts
interface GameState {
  version: 1; engineVersion: string; seed: string; ruleset: 'n23'
  phase: 'setup' | 'priority' | 'action' | 'end' | 'ended'
  round: number; seq: number; nextDecision: number
  pending: PendingDecision | null; rng: RngState; hash: string; log: Action[]; lastRollSeq: number
  origin: { setup: GameSetup }
  data: GameData                   // snapshot of every record the game uses (fighter types, weapons, traits, skills,
                                   // wargear, actions, dice faces, constants, scenario)
  board: BoardState                // { def: BoardDef (static), doors, caskets, smoke }
  players: Record<Seat, PlayerState>  // { seat, houseId, gangName, role, startingCrew, bottled, bottledVoluntarily, points }
  fighters: Record<string, Fighter>
  priority: Seat | null
  setup: SetupState                // step, roll-off, crew picks, casket queue, zone choices, deploy turn
  action: ActionPhaseState         // turn, activation, group, voluntary-flight progress
  end: EndPhaseState               // step, queues for bottle/flee/recovery/rally, assists used
  attack: AttackState | null       // the Shoot or Fight sequence in progress (stages, hit queue, reactions)
  nerve: NerveCheck[]              // nerve tests owed, resolved after the current hit (R-12.1)
  effects: ActiveEffect[]; nextEffect: number
  casualties: CasualtyRecord[]
  scenario: ScenarioState          // id, crew cap, caskets opened/secured, points, locked result, deploy tiles
  result: GameResult | null        // { winner: Seat | 'draw', points, reason: 'scenario' | 'resign' | 'concede' | 'roundLimit' }
}

interface GameSetup {
  ruleset: 'n23'
  scenarioId: string
  boardId: string
  gangs: Record<Seat, { houseId: string; name: string; starterId?: string; roster: RosterFighter[] }>
  options?: {
    autoCrew?: boolean; autoCaskets?: boolean; autoDeploy?: boolean   // engine answers those set-up decisions
    maxRounds?: number               // sims and tests only: end with reason 'roundLimit' after this round
    firstPriority?: Seat             // tests only: skip the round-1 priority roll
  }
}
interface RosterFighter { id: string; typeId: string; name: string; weapons: string[]; wargear: string[]; skills: string[] }

interface Activation {
  fighterId: string; seat: Seat
  actionsLeft: number              // 2 at start
  performed: { action: string; type: 'simple' | 'basic' | 'double' | 'free' }[]
  canTurn: boolean                 // true before the first action and after each move (R-4.1)
  aimed: boolean; charged: boolean; turnedToFace: boolean
  groupLeaderId?: string           // set when activated as part of a group (cannot start its own group)
  declared: { action: string; params?: Record<string, unknown> } | null
}
interface GroupState { leaderId: string; seat: Seat; members: string[]; done: string[] }
```

### 7.6 query.* (the only source of displayed numbers)

`status`, `stat`, `actionMenu` (with reasons for absent actions in `context.withheld` for the UI tooltip), `engagedWith`, `losLine`, `inArc`, `cover`, `distance` (base edge), `pathDistance`, `shootTargets(shooterId, weaponId, profileId)` (eligibility, priority class, band, cover, need, chance), `hitChance`, `woundChance`, `saveChance`, `injuryOdds(dice, traits)`, `expectedOutcome(attacker, weapon, profile, target)` -> `{ pHit, pWoundPerHit, pUnsaved, expectedWounds, pSeriouslyInjured, pOutOfAction, pPinned }`, `chargeTargets(fighterId)` with `pReach` over the D3, `fightOutcome(attacker, weapons, targets)` (attacker hits and expected reaction damage), `nerveOdds`, `bottleOdds`, `blastPreview(aim)`, `templatePreview(aim)`, `scenarioView` (points, caskets, locked result). The AI and the client read these; neither re-derives a rule.

## 8. Error handling

`step` never throws on bad input: `rejection { code, reason, details? }`, same state, pending unchanged, `events = [ActionRejected]`. Codes:

`E_WRONG_DECISION`, `E_WRONG_SEAT`, `E_NOT_AN_OPTION`, `E_OUT_OF_RANGE` (beyond Long range or move allowance), `E_OVERLAP` (base over a base, wall, door, obstacle or off the board), `E_ONE_INCH` (the 1" rule, R-7.3), `E_NO_PATH` (a path segment crosses a wall, closed door or board edge, or no legal spot exists), `E_NO_ACTIONS` (no actions left, or a Double with one left), `E_ACTION_RESTRICTED` (Basic repeated, Free and Basic of the same name, status or condition forbids, Broken, Engaged), `E_INVALID_TARGET` (not an enemy, hidden Prone in cover, not engaged, door not closed), `E_NOT_VISIBLE` (no line of sight or outside the vision arc), `E_OUT_OF_AMMO`, `E_PASS_NOT_ALLOWED`, `E_GAME_OVER`, `E_SCHEMA`, `E_TODO` (a rule stubbed until a later stage). Programmer errors throw `EngineInvariantError`.

## 9. Performance budgets

`step` p50 < 0.5 ms, p99 < 3 ms excluding target enumeration; `shoot.target` enumeration (line of sight + cover for 15 vs 15 fighters) < 10 ms; `nav.pathDistance` < 0.3 ms with a warm graph (graph rebuilt only when a door changes or a new radius is asked); `legalActions` < 5 ms; headless sim >= 3 games/s (random bots, 2 x 10 fighters); AI normal p50 < 50 ms per decision in a worker with a 3 s hard stop; client 60 fps with 20 fighters and a 7-tile board (instanced wall segments, one draw call per wall material); JS <= 2.5 MB gzip; `GameState` JSON < 150 KB (the compiled `BoardDef` included).

## 10. Settled items

- No ploys, CP, Guard, counteract, orders or tactic cards in v1; their machinery (ploy windows, ledgers, team-rule providers) is not carried over. Skills and house rules use hooks and `skill.choice` only.
- Roll-offs and every test without a choice are automatic; the presentation director plays them from `DiceRolled` events.
- Pre-measuring is allowed for both human and AI (R-1.10 ruling): every `query` distance is available before committing.
- Charge paths are engine-made (shortest legal route, R-7.6 ruling); the player declares only the target.
- Engagement is derived from geometry after every step, never set by hand.
- A group activation is a chain: `action.group` nominates, then `action.activate` offers only the group until it is done.
- Nerve tests caused during an attack are queued and resolved when the hit that caused them is fully resolved; a fighter that breaks makes its Running for Cover then, inside the current step.
- Fled fighters count as Out of Action for bottle, scoring and battle end.

## 11. Contract change log (additive only)

- M0 (2026-10-26): initial Necromunda contract, written over the Murder Squad M11 contract (`kill-team-reference/00-architecture.md`). Kept unchanged: `step` / `StepResult` / `legalActions` / `validate` / `replay` / `view` / `save` / `load` / `undo`, the action envelope, `PendingDecision`, `Decider`, `Rng`, the registry and code-hook mechanisms, the hash and replay rules. Replaced: phases, decision kinds, timing windows, events, game state, operative -> fighter, error codes (KT-only codes `E_CONTROL_RANGE`, `E_NO_AP`, `E_INSUFFICIENT_CP`, `E_PLOY_USED` removed; `E_ONE_INCH`, `E_NO_ACTIONS`, `E_OUT_OF_AMMO` added). New: `suggest`, `GameSetup.ruleset`, `DiceRolled.die`.
