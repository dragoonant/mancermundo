# 20 — Data schema

All content is JSON under `src/data/`, validated at build by `tools/validate-data.ts` against `docs/spec/schemas/*.schema.json` (JSON Schema 2020-12, `$id` `https://mancermundo.dev/schemas/<name>.schema.json`), mirrored in `src/data/schema/` and typed in `src/data/types.ts`. Every record carries `source` (`"team-angels-of-death.pdf p3"`, `"wahapedia core-rules"`, …). All prose (`text`) is our own wording. The schema is **frozen after a dry run that encodes both v1 teams, the universal equipment and Preliminary Ops**; later changes are additive.

## 1. Files
| Path | Schema | Content |
|---|---|---|
| `src/data/core/weapon-rules.json` | `weapon-rule[]` | the universal weapon rules (id, param kind: none / x inches / x count / x+ target / `crits` variant) |
| `src/data/core/universal-equipment.json` | `equipment[]` | Comms Device, Mines, Ammo Cache, Razor Wire, Utility Grenades, Frag/Krak grenades, Portable Barricade, Ladders, Light/Heavy Barricade… as published |
| `src/data/core/ploys.json` | `ploy[]` | Command Re-roll |
| `src/data/teams/<team>/team.json` | `team` | name, faction keyword, archetypes, selection rules, faction rules, paint scheme (two hues) |
| `src/data/teams/<team>/operatives.json` | `datacard[]` | one per operative type |
| `src/data/teams/<team>/weapons.json` | `weapon[]` | one per profile |
| `src/data/teams/<team>/abilities.json` | `ability[]` | datacard abilities and unique actions |
| `src/data/teams/<team>/ploys.json` | `ploy[]` | strategy and firefight ploys |
| `src/data/teams/<team>/equipment.json` | `equipment[]` | faction equipment |
| `src/data/missions/*.json` | `mission` | Preliminary Ops (per crit op), later Approved Ops |
| `src/data/killzones/*.json` | `killzone-layout` | terrain pieces with traits and positions, drop zones, objective spots per map |
| `src/data/index.ts` | — | `loadBundle(): DataBundle` (byId maps, `dataVersion`), throws on duplicate id or dangling ref; `CODE_HOOKS`, `playableTeamIds` |

Ids: lowercase kebab, dot-namespaced: `aod.intercessor-sergeant`, `aod.w.bolt-rifle`, `aod.a.heroic-leader`, `aod.p.combat-doctrine`, `kom.boss-nob`, `core.wr.piercing`, `core.e.mines`, `mission.prelim-secure`, `kz.volkus-ao25-1`.

## 2. Shared primitives (`common.schema.json`)
`Id`, `Keyword` (`^[A-Z0-9][A-Z0-9 '\-]*$`), `RollTarget` (2..6 as `x+`), `Inches` (number, multiples of 0.5), `DiceExpr` (`D3`, `D6`, `2D6`, `D3+3`, int), `Vec2 {x,z}`, `Vec3`, `Polygon`, `TimingWindowId` (00 §4 enum), `Seat`, `Order` (`engage|conceal`), `TerrainTrait` (`light heavy blocking vantage accessible insignificant exposed ceiling barred wall`), `Condition`, `Effect`, `TargetSpec`.

## 3. Datacard
```json
{ "id":"aod.intercessor-sergeant", "name":"Intercessor Sergeant", "team":"angels-of-death",
  "stats": { "apl":3, "move":6, "save":3, "wounds":15 }, "base": 32,
  "keywords": ["ANGEL OF DEATH","IMPERIUM","ADEPTUS ASTARTES","LEADER","INTERCESSOR","SERGEANT"],
  "weapons": { "fixed": ["aod.w.fists"], "options": [ { "id":"ranged", "pick":1, "from":["aod.w.auto-bolt-rifle","aod.w.bolt-rifle","aod.w.stalker-bolt-rifle"] },
                                                      { "id":"melee", "pick":1, "from":["aod.w.chainsword","aod.w.power-fist","aod.w.power-weapon","aod.w.thunder-hammer"] } ] },
  "abilities": ["aod.a.heroic-leader-sgt"], "uniqueActions": ["aod.a.get-it-dun"],
  "figure": { "archetype":"aod-intercessor", "variant":"sergeant" },
  "source":"team-angels-of-death.pdf p2" }
```
- `weapons.options[].pick` may be `0..n` with `min`; mutually exclusive weapon sets use `sets: [[ids],[ids]]`. Multi-profile weapons (plasma pistol standard/supercharge, stalker heavy/mobile) share `profileGroup` on the weapon and are listed once in options.
- `figure.archetype` names a body GLB; weapons map to attachment GLBs by weapon id (30-figures).
- Flags handled natively by the engine: `expendable` (ignored for kill op), `noConceal`, `stoopidActions` (restricted action list), `canFightTwice`, etc. are expressed as abilities with `code` rather than datacard flags, except `expendable` and `nonOperativeForSelection` which are datacard booleans.

## 4. Weapon
`{ id, name, type: ranged|melee, atk, hit (RollTarget), dmg: {normal, crit}, rules: [{ rule: Id, x?: number, inches?: number, target?: RollTarget, crits?: boolean }], profileGroup?, text? (only for bespoke starred rules, own words), code?: hookName, source }`. `rules[].rule` must exist in `core/weapon-rules.json` or be a team-local rule defined in `abilities.json` with `kind: "weaponRule"`.

## 5. Ability / unique action (declarative with escape hatch)
```json
{ "id":"kom.a.get-it-dun", "kind":"uniqueAction", "name":"Get It Dun!", "ap":1, "keywords":["SUPPORT"],
  "conditions": { "notInEnemyControlRange": true, "notCounteracting": true },
  "effect": { "code":"getItDun", "params": { "range":6, "aplDelta":1, "until":"endOfTargetNextActivation" } },
  "text":"own-words summary", "source":"team-kommandos.pdf p1" }
```
`kind`: `ability | uniqueAction | weaponRule | factionRule | archetype`. Triggers for passive abilities: `window` (TimingWindowId) + `when` (Condition) + `effect` (Effect | Effect[]) + `limit` (`oncePerBattle | oncePerTurningPoint | oncePerActivation`) + `scope`. Effect keys: `modifyStat {stat: apl|move|save|wounds|hit, value, cap?}`, `grantWeaponRule {rule, x?}`, `reroll {dice: attack|defence, which: one|any|result:n}`, `ignoreDamage {kind: normal|crit|all, once?}`, `retainSuccess {kind: normal|crit, count}`, `extraAction {action, count}`, `cp`, `vp`, `move {inches}`, `setOrder`, `apl {delta, until}`, `damage {amount|dice}`, `code {name, params}`. Unknown keys fail validation; every `code` must be registered in `src/engine/code-hooks.ts` and `validate:data` checks this.

## 6. Ploy
`{ id, name, type: strategy|firefight, cost: 1, window, when?, effect, text, limit: oncePerTurningPoint (default) | unlimited (Command Re-roll), source }`. Strategy ploys are STRATEGIC GAMBITs by definition.

## 7. Equipment
`{ id, name, scope: universal|faction, team?, count: 1, setup?: { marker|terrain, whollyWithinTerritory, minDistanceFrom: [...] }, grants?: { weapons?, abilities?, actions? }, actions?: [uniqueAction ids], text, source }`. Universal equipment is selectable by any team; each option at most once per game; each team selects up to the mission's equipment count (Preliminary Ops: per the sources, recorded in 11).

## 8. Team
```json
{ "id":"angels-of-death", "name":"Angels of Death", "factionKeyword":"ANGEL OF DEATH",
  "archetypes": ["seek-and-destroy","security"],
  "selection": { "operatives": 6, "required": [{ "oneOf": ["aod.intercessor-sergeant","aod.assault-intercessor-sergeant","aod.space-marine-captain"] }],
                 "groups": [{ "id":"squad", "exclusive": true, "sets": [ { "name":"Intercessors", "from":[...] }, { "name":"Assault Intercessors", "from":[...] } ] }],
                 "maxPerDatacard": { "aod.intercessor-gunner": 2 } },
  "factionRules": ["aod.a.chapter-tactics","aod.a.combat-doctrine"],
  "paint": { "major": {"h":0.6,"s":0.6,"l":0.35}, "minor": {"h":0.12,"s":0.7,"l":0.45} },
  "source":"team-angels-of-death.pdf p1" }
```
The exact selection shape is finalised during the dry run from `13-teams.md`; the validator enforces that every datacard/weapon referenced exists and that at least one legal roster exists.

M9 prep (additive): `playable: false` marks a scaffolded team (validated and loaded, left out of the team picker, the real-team sims and the client presentation coverage tests until flipped); `defaults: { roster, equipment, teamChoices }` replaces the engine's per-team default tables; a selection slot may carry `weights` (datacard id to the number of selections it counts as, 2 or more) and `caps` (`[{ label?, from, max }]`, at most `max` of those datacards together). Equipment may carry `grants.to: { keyword?, notKeywords? }` (who receives granted weapons; absent: every non-Expendable operative), `hidden` (markers hidden from the opponent until they trigger) and `excludes` (equipment ids it cannot be taken with); any equipment whose effect is `{ "code": "mines" }` behaves as a mine. The list of code hooks the data names is derived at load time (`CODE_HOOKS` in `src/data/index.ts`); there is no generated `code-hooks.json`.

M9 batch B (additive): a datacard may carry `ovalBase: { long, short, weapons? }` (an oval base in mm, long axis along the facing; with `weapons`, only loadouts carrying one of those weapon ids use it) and `extraEquipment` (extra equipment options while it is on the roster). A team may carry `operativeChoices` (`[{ id, label, keywords, forKeyword?, exclude?: [{ datacards, keywords }] }]`: a keyword every eligible operative takes at selection, a real keyword in the engine), `selection.caps` (`[{ label?, keyword? | from?, max }]`, counted over every slot) and `selection.loadoutCaps` (`[{ label?, weapons, max, each? }]`, operatives carrying those weapon profiles or groups, fixed weapons included), and `defaults.operativePicks` / `defaults.loadouts` (one entry per default roster datacard). Windows `firefight.opponentActionDeclared`, `firefight.beforeActivation`, `ploy.opponentUsed`, `operative.killed`, `shoot.beforeAttackRerolls`, `shoot.beforeDefenceRoll` and `shoot.defenderBeforeRerolls` join the `TimingWindowId` enum.

M9 batch C (additive): `selection.caps[]` may give `min` instead of or with `max` (at least one SORCERER); `selection.requires` lists `{ id, needs }` (a datacard allowed only when one of `needs` is on the roster: Gheistskull needs Void-Jammer); `operativeChoices[]` may set `unique` (no two operatives of the roster share a pick: Boons of Tzeentch), `distinctFrom` (choice ids the same operative's pick must differ from: Custom weapon rules) and `keyword: false` (the pick is a tag for team code, not a keyword). A unique action whose `keywords` include PSYCHIC is a PSYCHIC action; a weapon rule ability named PSYCHIC (`<p>.a.wr-psychic`) marks PSYCHIC weapons for every team's rules (`src/engine/psychic.ts`).

M10 batch D (additive): a datacard may set `selectable: false`: it is never offered for a roster and sits in no selection slot (validate-data refuses it in one), but its record is snapshotted into every game that has its team so an operative can change into it mid-battle (`src/engine/transform.ts`; Chaos Cult Mutant and Torment).

## 9. Mission and killzone layout
Mission: `{ id, pack: "preliminary-ops", critOp: secure|loot|transmission, turningPoints: 4, killOp: { gradeTable: {startingOperatives: thresholds[]} }, actions: [mission action ids], scoring: [ScoringRule], objectiveSetup: {...}, source }`. Killzone layout: `{ id, name, size: {x:30,z:22}, maps: [{ id, dropZones: {A: Polygon, B: Polygon}, territories, centreline, objectiveSpots?, pieces: [{ model: slug, pos, yaw, parts: [{ footprint: Polygon, height, traits: [TerrainTrait], vantageFloors?: number[] }] }] }], source }`.

## 10. Validation (`tools/validate-data.ts`)
Schema per file; unique ids; every ref resolves; every `code` registered; every weapon rule known; each datacard has a figure archetype; each team has ≥1 legal roster; mission objective spots respect the placement constraints; terrain pieces inside the board; both teams' operative counts match the team PDF. Output: `ok` or a list of `path: message` lines; exit code non-zero on error.
