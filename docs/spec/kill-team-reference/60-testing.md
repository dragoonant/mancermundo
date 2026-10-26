# 60 — Testing

Lean: tests protect a working build. About 10 focused tests per stage plus the golden examples; no coverage chasing. Engine tests are named by checklist ID from `12-rules-test-checklist.md` (`it('SHOOT-004 cover save retains one normal success')`), one ID per `it`.

## 1. Commands and gates
| Gate | Command | Passes when |
|---|---|---|
| G1 | `npm run typecheck` | clean |
| G2 | `npm test` | all Vitest suites green (`tests/{engine,data,ai,client}`) |
| G3 | `npm run validate:data` | 0 errors |
| G4 | `npm run sim -- --games 50 --seed 1` | 50/50 games end, 0 invariant violations, replay hash matches |
| G5 | `npm run bench:ai` | normal ≥ 95% vs random, 0 rejections/stalls/fallbacks |
| G6 | `npm run e2e` | Playwright full game vs bot passes; mobile smoke on `pixel` |
CI (`deploy.yml`) runs G1–G3 and the build; G4–G6 run locally before each push.

## 2. Engine tests
- `ScriptedRng([...])` for exact dice; `SeededRng` for statistical checks (≥ 2000 samples, 3% tolerance); fixtures in `tests/fixtures/` (synthetic datacards, not the real teams, so rules tests survive data corrections).
- Golden tests `tests/engine/golden.test.ts` replay `14-golden-examples.md` with forced dice (GOLD-001..004).
- `tests/engine/action-fuzz.test.ts`: seeded random games asserting a non-empty, validating legal set at every decision.
- `tests/engine/boundaries.test.ts`: import direction `data ← engine ← ai ← client`.
- `tests/engine/code-hooks.test.ts`: every registered code hook fires in a real game fixture (team hooks included).
- Data: `tests/data/*.test.ts` validate every file, cross-refs, both teams' operative counts and a legal default roster per team; `tests/client/weaponSounds.test.ts` fails on any weapon id without a flavour; `tests/client/noNativeTooltips.test.ts`.

## 3. Sim invariants (`tools/sim-core.ts`, checked after every step)
No NaN/Infinity; wounds within [0, starting]; every operative inside the killzone, no base overlap, not inside blocking terrain; AP spent ≤ APL per activation; the same action never twice in one activation unless a rule allows; Conceal operatives never Shoot/Charge; an operative never ends a move in enemy control range except Charge; CP ≥ 0; VP non-decreasing and ≤ caps; exactly one pending decision before `ended`, with ≥ 1 legal action or `canPass`; zero rejections from the random bot; replay reproduces every hash; game ends after turning point 4 within 3000 decisions and a 200-decision stall detector; every `DiceRolled` has dice in 1..6; `OperativeIncapacitated` iff wounds ≤ 0. Output `tools/out/sim-report.json` with failing seeds and action logs for `--replay`.

## 4. Playwright
`tests/e2e/play.spec.ts`: `?test=1&seats=human,bot&seed=e2e-1&speed=instant`, deploy by clicks, play a full turning point by UI (order, move, shoot, fight, mission action), then auto-answer to the end; assert end screen VP numeric and hash replay equal. `home.spec.ts`, `team-builder.spec.ts` (illegal loadout disabled with reason), `mobile-smoke.spec.ts` (pixel, drawers and sheet). Drags use `page.mouse` with ≥ 10 steps; specs fail on console errors; `screenshotRendered()` waits for the demand frameloop. Screenshots to `e2e-out/` (gitignored); milestone shots copied to `screenshots/` for the owner.

## 5. Rules fidelity
Ambiguities are `RULING:` lines in `docs/needs-rules-check.md` with a status word. Before each push an agent greps the checklist IDs present in tests and lists the uncovered ones in `STATUS.md` (no separate coverage tool).
