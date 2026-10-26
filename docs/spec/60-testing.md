# 60 - Testing

Lean: tests protect a working build. Engine tests are named by checklist ID from `12-rules-test-checklist.md` (`it('SHOOT-004 ...')`); `STATUS.md` lists the IDs without a test before each push (no coverage tool). The Kill Team version of this file is kept in `kill-team-reference/60-testing.md`.

## 1. Commands and gates

| Gate | Command | Passes when |
|---|---|---|
| G1 | `npm run typecheck` | clean |
| G2 | `npm test` | every Vitest suite green (`tests/{engine,data,ai,client}`) |
| G3 | `npm run validate:data` | `ok (<n> records)`, 0 problems |
| G4 | `npm run sim -- --games 50 --scenario <id>` for each of the three scenarios | 50/50 games end by their scenario, 0 invariant violations, 0 random-bot rejections |
| G5 | `npm run bench:ai` | the S6 targets (`40-ai.md`) |
| G6 | `npm run e2e` | Playwright specs pass, one full game to the end screen |

`npm run sim` flags: `--games N` (default 20), `--seed S`, `--scenario all|scn.tunnel-skirmish|scn.smash-and-grab|scn.forgotten-riches` (default `all`: game g plays scenario g mod 3, then the boards the scenario allows in turn, Goliath against Escher with the seats swapped every other game and the starter gangs rotating), `--rounds N` (the old short-game cap, off by default), `--gangs fixture` (synthetic gangs on the hand-built boards), `--replay tools/out/sim-report.json [index]`. It prints a line of totals, the event counters, the casualties of each game and one row per scenario: games, winner by seat and by house, mean rounds, longest game, gangs that bottled (and how many by choice), mean round of the first bottle, mean casualties, mean decisions and how the games ended (`scenario`, `concede` after a locked Smash & Grab win). The full report with failing seeds and their action logs is written to `tools/out/sim-report.json`.

## 2. Engine tests

- `ScriptedRng([...])` feeds exact D6 results (and, for scatter, a whole number of degrees) in the order the rules draw them; it throws when the script runs dry or a value is out of range, so a short script is never silent. A test lists the dice of the step in order (for the End phase: the Bottle roll, the flee tests as pairs of dice, the recovery Injury dice, the Rally pairs, the smoke rolls and, when the round turns over, the two Priority dice).
- Fixtures in `tests/fixtures/`: `gang.ts` (synthetic house `test`, five fighters per gang: Leader Cl 5+ with Leading by Example, Champion Cl 6+, two gangers Cl 7+, a juve Cl 8+), `attack.ts` (the real special-dice faces and an armoury of trait weapons), `melee.ts`, `boards.ts` (open box, door, barricade, ductway), `real.ts` (the real Goliath and Escher data through `bundleFromData`), `scenario.ts` (`battle({ scenarioId })`: real gangs taken to round 1's first activation with the engine answering crews, caskets and deployment) and `helpers.ts` (`startGame`, `place`, `edit`, `take`, `endRound`, `playOut`: play on from an Action phase with every activation ended at once and the End phase answered with the plain answers, collecting every event).
- Rules tests use the synthetic fixtures so they survive data corrections; scenario tests use the real data because the scenarios are data (`src/data/scenarios`).
- `tests/engine/golden.test.ts` (GOLDEN-001): one forced-dice round of the Goliath and Escher starter gangs on an open floor (a fixed LCG die stream, a scripted policy that charges, shoots or ends), pinned as a digest: final state hash, decision count, event counts, the casualty log, the points and the dice drawn. Regenerate with `GOLDEN_PRINT=1 npx vitest run tests/engine/golden.test.ts`, read the changed events, then paste the new digest.
- `tests/engine/sim.test.ts`: a few seeded games through the sim loop (all three scenarios, no round limit), replay of the action log to identical hashes, and the invariant checker itself (it must flag what it is meant to flag).
- `tests/engine/code-hooks.test.ts`: every scenario code hook (`horrorsInTheDark`, `smashAndGrabVictory`, `smashAndGrabCaskets`) is registered with a params validator and fires in a real game (`hookFireCount > 0`); house hooks are proved by their own files (S4K). Queries such as `scenarioView` never count as a rule firing.
- `tests/engine/boundaries.test.ts`: import direction `data <- engine <- ai <- client`, and no import of `legacy/`.
- Data: `tests/data/*.test.ts` validate every file, the cross references, the boards and scenarios and the gangs; client tests cover the store, presentation, prompts, labels, glossary and the ban on native tooltips.

## 3. Sim invariants (`tools/sim-core.ts`, checked after every step)

Carried over from S2 and S3: no NaN or Infinity; Wounds within [0, starting] and Flesh Wounds within [0, T]; every fighter on the board inside the outline and overlapping no wall, closed door, obstacle or base; a fighter that is not on the board is never Engaged; Engaged fighters are Standing and fight Standing enemies on the board; no more than two actions per activation, no Basic action twice, a Double only first and with two left; groups of at most 2; no voluntary move ending within 1" of a Standing or Pinned enemy and none beyond its allowance; every `DiceRolled` face legal; `seq` increases by one; exactly one pending decision with a legal answer (every listed action passes `validate`, a continuous decision can be passed or has a valid `suggest`) until the battle ends, then none; zero rejections from the random bot; replay reproduces every hash.

Added in S4 (the full game):

- a gang that has bottled never stops being bottled, and a voluntary bottle never loses its flag;
- points never fall; the scenario's mirrored points equal the gang's; every Out of Action or fled fighter pays the scenario's points to the other gang when the scenario scores that trigger;
- a fled or Out of Action fighter never returns to the board; a fled fighter holds no Ready, no casket and no engagement and has a casualty record of kind `fled`;
- every `BottleTest` counts the fighters down (Seriously Injured, Out of Action and fled together) and the starting crew exactly, bottles on `roll + down > crew` or by choice, and never happens twice for a bottled gang;
- the battle ends by its scenario (`scenario`, or `concede` after a locked win), never by a round limit nobody set and never by resignation, with the result's points equal to the gangs' and, in a points scenario, the winner equal to the higher score;
- the round counter never passes 20 (`MAX_ROUNDS`), a game uses at most 4000 decisions (`MAX_DECISIONS`) and no 200 consecutive decisions (`STALL_LIMIT`) leave the progress key unchanged (phase, round, Ready fighters, fighters on the board and gone, the active fighter and its actions, set-up progress, End phase queues, flight and the locked-win answer).

The sim bots are random-legal with weights (see the ruling "Sim bots" in `needs-rules-check.md`): they move toward the enemy by the engine's own routes, walk up to the first closed door on the way, prefer opening doors, shoot fighters more than doors, pick crews up to the cap, deploy by the engine's spots on tile strips, take the Bottle test 85% of the time and continue after a locked win half the time. They are test bots, not a model of a player.

## 4. Playwright

`tests/e2e/play.spec.ts`: `?test=1&seats=human,bot&seed=e2e-1&speed=instant`, deploy by clicks, play a round by the UI against the random bot. `home.spec.ts`, `gang-picker.spec.ts`, `mobile-smoke.spec.ts`, `ui-consistency.spec.ts`, `lab.spec.ts`. Specs fail on console errors; screenshots go to `tools/out/` for the owner.

## 5. Checklist coverage

The IDs of `12-rules-test-checklist.md` and where they are tested:

| Area | IDs | File |
|---|---|---|
| Dice, tests | DICE, TEST | `dice.test.ts` |
| Statuses | STATUS | `status.test.ts` |
| Vision, cover | VIS | `vis.test.ts` |
| Rounds, activation | ROUND-001..005, 006, 007 | `round.test.ts` (006 and 007 drive the End phase) |
| Actions, movement | ACT, MOVE | `act.test.ts`, `move.test.ts` |
| Shooting, blasts, injuries, traits | SHOOT, BLAST, INJ, TRAIT | `shoot.test.ts`, `blast.test.ts`, `inj.test.ts`, `trait.test.ts` |
| Close combat, nerve | CC, NERVE | `cc.test.ts`, `nerve.test.ts` |
| End phase | END-001..011 | `end.test.ts` |
| Board | ZM | `zm.test.ts`, `board.test.ts` |
| Scenarios | SCEN-001 (`setup.test.ts`), SCEN-002..011 | `scen.test.ts` |
| Golden round | GOLDEN-001 | `golden.test.ts` |
| Sim | SIM-001..005 | `sim.test.ts` |

## 6. Rules fidelity

Ambiguities are `RULING:` lines in `docs/needs-rules-check.md` with a status word. Before each push an agent greps the checklist IDs present in tests and lists the uncovered ones in `STATUS.md`.
