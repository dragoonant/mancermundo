# 20 - Data schema

All content is declarative JSON under `src/data/`, validated at build by `tools/validate-data.ts` (and `tests/data/*.test.ts`) against JSON Schema 2020-12 files in `src/data/schema/` (one copy only; the Kill Team habit of mirroring them under `docs/spec/schemas/` is dropped), typed by hand in `src/data/types.ts`. Every record carries `source` (`"House of Chains p34"`, `"Necrodamus N23 p61"`, `"13-gangs.md 2.1"`, `"own design"` for boards). All prose (`text`) is our own wording, never Games Workshop text; names of gangs, fighters, weapons, traits and skills may match the books. The schema is **frozen after the S1D, S1Z and S1G dry run that encodes both v1 houses, their starter gangs, the five boards and the three scenarios (see `05-migration.md`)**; later changes are additive and get a row in `00-architecture.md` section 11.

Gang content itself (which fighters, weapons, skills and starter gangs) is specified in `13-gangs.md`; this file only fixes the shapes. Where the two disagree on shape, this file wins; on content, `13-gangs.md` wins.

## 1. Files

| Path | Schema | Content |
|---|---|---|
| `core/actions.json` | `action[]` | the action catalogue: id, name, cost type, statuses that may take it, requirements (R-6.3 table) |
| `core/dice.json` | `dice` (one object) | Firepower, Injury and Scatter face tables (R-1.2 to R-1.4) |
| `core/constants.json` | `constants` (one object) | rule numbers the engine reads: radii (nerve 3, group 3, leading by example 12/6, assist 1, rally 3), retreat dice, stray-shot roll, closing-door test, door profile, force-door target, smoke radius and clear roll, crew-cap table |
| `core/traits.json` | `trait[]` | every weapon trait name of R-14.2 with its parameter kind and `implemented` flag |
| `core/weapons.json` | `weapon[]` | weapons any house can carry (Trading Post common stock: autogun, lasgun, stub gun, frag and krak grenades, knives...) |
| `core/wargear.json` | `wargear[]` | armour (flak, mesh, carapace) and common wargear |
| `core/skills.json` | `skill[]` | the skill sets (Agility, Brawn, Combat, Cunning, Ferocity, Leadership, Shooting, Savant) as far as `13-gangs.md` needs them |
| `core/fighter-rules.json` | `rule[]` | rules carried by fighter types of any house: Group Activation (X), Leading by Example and any other fighter rule `13-gangs.md` lists as shared between houses |
| `gangs/<house>/house.json` | `house` | house id and name, id prefix, house rules, fighter types, skill sets, gang composition, paint scheme |
| `gangs/<house>/fighters.json` | `fighter-type[]` | one record per fighter type: role, cost, characteristics, base, rules, equipment list, skill access, figure archetype |
| `gangs/<house>/weapons.json` | `weapon[]` | house-only weapons |
| `gangs/<house>/wargear.json` | `wargear[]` | house-only wargear |
| `gangs/<house>/skills.json` | `skill[]` | house skill set(s) |
| `gangs/<house>/rules.json` | `rule[]` | house rules and fighter-type rules |
| `gangs/<house>/equipment-lists.json` | `equipment-list[]` | per fighter-type list of weapons and wargear it may buy, with cost (builder only; v1 checks starter gangs against it) |
| `gangs/<house>/starter-gangs.json` | `starter-gang[]` | the pre-built 1000-credit gangs v1 plays with (M-1.1) |
| `zm/tiles/<id>.json` | `zm-tile` | one 12" Zone Mortalis tile: walls, doors, ductways, obstacles, casket spots, floor look |
| `zm/boards/<id>.json` | `zm-board` | a board: tile placements with rotation, extra features, scenario legality |
| `scenarios/<id>.json` | `scenario` | Tunnel Skirmish, Smash & Grab, Forgotten Riches (M-2 to M-4) |
| `index.ts` | - | `loadBundle(): DataBundle` (byId maps, `dataVersion`), throws on duplicate id or dangling ref; `CODE_HOOKS` (every code name the data uses, with the records using it); `houseIds`, `starterGangs(houseId)` |
| `manifest.ts` | - | every data file with the schema def it validates against; assembled from four area index files with static JSON imports (works under Vite, Vitest and tsx): `core/index.ts`, `gangs/index.ts`, `zm/index.ts`, `scenarios/index.ts`. Each area's stage edits only its own index, so stages adding data never touch the same file. `validate:data` fails on a JSON file under `src/data/` that no index lists. |

Ids: lowercase kebab, dot-namespaced by owner: `core.a.move`, `core.t.rapid-fire`, `core.w.lasgun`, `core.g.flak-armour`, `core.s.agility.sprint`, `core.r.group-activation`, `gol.forge-tyrant`, `gol.w.renderizer`, `gol.g.<id>`, `gol.s.<id>`, `gol.r.<id>`, `gol.sg.starter-1`, `esc.matriarch`, `zm.t.<tile>`, `zm.b.<board>`, `scn.tunnel-skirmish`. House prefixes: `gol` (Goliath), `esc` (Escher).

## 2. Shared primitives (`common.schema.json`)

`Id`, `Source` (non-empty string), `Text` (own words), `Inches` (number, multiples of 0.25), `Target` (`"2+"` .. `"12+"`, parsed to the number before `+`), `Stat` (enum `M WS BS S T W I A Ld Cl Wil Int`), `DiceExpr` (`"D3"`, `"D6"`, `"2D6"`, `"D3+1"`, or an integer), `Vec2 {x,z}`, `Segment {a,b}`, `Polygon` (3+ `Vec2`, counter-clockwise), `Seat`, `TimingWindowId` (enum of `00-architecture.md` section 4), `Hsl {h,s,l}`, `Condition`, `Effect`, `EffectList`, `CodeRef { code: string, params?: object }`.

## 3. Fighter type (`gang.schema.json#/$defs/fighterType`)

```json
{ "id": "gol.forge-tyrant", "name": "Forge Tyrant", "house": "goliath",
  "role": "leader", "cost": 0,
  "stats": { "M": 4, "WS": "3+", "BS": "4+", "S": 4, "T": 4, "W": 2, "I": "4+", "A": 2,
             "Ld": "5+", "Cl": "5+", "Wil": "6+", "Int": "6+" },
  "base": 32,
  "rules": [ { "rule": "core.r.group-activation", "x": 2 }, { "rule": "core.r.leading-by-example" } ],
  "skillAccess": { "primary": ["brawn", "ferocity", "leadership"], "secondary": ["combat", "gol-house-set"] },
  "equipmentList": "gol.el.leader",
  "limits": { "min": 1, "max": 1 },
  "figure": { "archetype": "goliath-leader" },
  "source": "13-gangs.md 2.1" }
```
(Numbers above are placeholders for shape only; `13-gangs.md` is the content source.)

- `role`: `leader | champion | ganger | juve | specialist | prospect` (open enum extended additively). Scoring (M-2.4) and leading by example read it.
- `stats`: plain numbers for `M S T W A`; `Target` strings for `WS BS I Ld Cl Wil Int`. Every key is required.
- `base`: base diameter in mm (25 default, 32 for large fighters).
- `rules`: fighter rules by id with an optional `x` parameter (Group Activation (X)).
- `figure.archetype` names a body GLB in `src/client/figures/manifest.ts`; weapon attachments are chosen by weapon id (30-figures).

## 4. Weapon (`item.schema.json#/$defs/weapon`)

One record per weapon; a weapon with several profiles (combi, grenade launcher ammo, plasma low/max) lists them all. Ammo state belongs to the weapon (R-8.9); Limited profiles are lost individually.

```json
{ "id": "core.w.boltgun", "name": "Boltgun", "class": "basic", "cost": 55, "rarity": null,
  "profiles": [
    { "id": "std", "name": null,
      "range": { "short": 12, "long": 24 }, "acc": { "short": 1, "long": 0 },
      "str": 4, "ap": -1, "dmg": 2, "ammo": "6+",
      "traits": [ { "trait": "core.t.rapid-fire", "x": 1 } ] } ],
  "flavour": "bolter",
  "source": "13-gangs.md 3.2" }
```

- `class`: `pistol | basic | special | heavy | close | grenade` (equipment-list grouping and weapon slots; Unwieldy uses two slots).
- `range.short`: inches or `null` (no Short range); `range.long`: inches, `"E"` (engaged only), `"T"` (template), or `{ "strMultiplier": 3 }` (grenades: Long = wielder's S x multiplier, R-14.3). Versatile weapons put their reach in `long`.
- `acc.short` / `acc.long`: integer modifiers or `null` (shown as "-").
- `str`: integer, `"S"` (wielder's S) or `"S+1"` / `"S-1"` style; parsed to `{ base: 'user' | 'fixed', value }`.
- `ap`: integer, 0 for "-" (AP -1 is `-1`); `dmg`: integer, `"-"` (no Wound loss, R-2.8) or a `DiceExpr`; `ammo`: `Target` or `"-"`.
- `traits[]`: `{ trait: Id, x?: number, inches?: number, target?: Target }`; `trait` must exist in `core/traits.json`. Weapon variants (Master-crafted, Twin-linked, Ironhead) are traits too.
- `flavour`: the client sound/vfx family (`stub`, `las`, `bolter`, `flamer`, `plasma`, `melta`, `grenade`, `chain`, `blade`, `maul`, `whip`, `crush`); `tests/client/weaponFlavour.test.ts` fails on a weapon without one.
- Optional `text` for a bespoke behaviour summary (own words) and `code` naming a code hook when a trait list cannot express it.

## 5. Trait (`core.schema.json#/$defs/trait`)

`{ id, name, param: "none" | "count" | "inches" | "target", implemented: boolean, text, source }`. Traits are engine-native (each has handlers in `src/engine/traits.ts`); they are not escape hatches. `implemented: false` traits may appear in the catalogue but `validate:data` refuses any v1 weapon carrying one (R-16.2), naming the weapon and trait.

## 6. Wargear (`item.schema.json#/$defs/wargear`)

`{ id, name, kind: "armour" | "fieldArmour" | "equipment" | "chem", cost, save?: Target, saveMods?: [{ vs: "front" | "template" | "blast", value }], effect?: EffectList, code?: CodeRef, text, source }`. One armour item provides a fighter's save (R-11.3); field armour and chems are `out of scope` for v1 and rejected by the validator unless `13-gangs.md` lists them for v1.

## 7. Skill and rule (`gang.schema.json#/$defs/skill`, `#/$defs/rule`)

```json
{ "id": "core.s.agility.sprint", "name": "Sprint", "set": "agility",
  "window": "action.declared",
  "when": { "action": "move", "repeatInActivation": true },
  "effect": { "modifyStat": { "stat": "M", "mult": 2 } },
  "text": "own-words summary", "source": "13-gangs.md 4.1" }
```

- Skill `set` names a skill set (core or house); a rule has `kind: "houseRule" | "fighterRule"`.
- Passive or triggered behaviour: `window` (TimingWindowId) + `when` (Condition) + `effect` (EffectList) + `limit` (`oncePerActivation | oncePerRound | oncePerBattle | unlimited`). An `action` block (`{ id, type: simple|basic|double|free, statuses, requires }`) adds a skill action to the menu instead.
- Condition keys (all optional, ANDed): `status` (one of the derived statuses), `action`, `charging`, `engaged`, `targetStatus`, `inVisionArcOfTarget` (bool), `weaponClass`, `weaponTrait`, `withinOfFriend { inches, role? }`, `role`, `phase`, `roundAtLeast`.
- Effect keys: `modifyStat { stat, value?, mult? }`, `modifyTest { test: nerve|cool|willpower|leadership|intelligence|initiative|strength|toughness, value }`, `modifyHit { kind: shoot|fight, value }`, `modifyWound { value }`, `modifySave { value }`, `extraAttackDice { value }`, `grantTrait { trait, x?, weapons?: WeaponFilter }`, `grantAction { action }`, `actionType { action, type }`, `reroll { roll: hit|wound|save|injury|test|charge, which: one|fails|all, grant: true }`, `ignore { what: pinning|fleshWound|nerve|turnToFace|... }`, `injuryDice { delta }`, `code: CodeRef`. Unknown keys fail validation.

## 8. House, equipment lists, starter gangs

```json
{ "id": "goliath", "name": "House Goliath", "prefix": "gol",
  "houseRules": ["gol.r.<id>"],
  "fighterTypes": ["gol.forge-tyrant", "gol.forge-boss", "..."],
  "skillSets": ["gol-house-set"],
  "composition": { "minFighters": 3, "roles": { "leader": { "min": 1, "max": 1 }, "champion": { "max": 2 } },
                   "ratio": [{ "roles": ["ganger"], "atLeastHalf": true }] },
  "paint": { "major": { "h": 0.02, "s": 0.6, "l": 0.4 }, "minor": { "h": 0.1, "s": 0.2, "l": 0.6 } },
  "source": "13-gangs.md 2" }
```

- `equipment-list`: `{ id, house, forTypes: [Id], weapons: [{ id, cost }], wargear: [{ id, cost }], source }`.
- `starter-gang`: `{ id, house, name, credits, fighters: [{ name, type, weapons: [Id], wargear: [Id], skills: [Id] }], text, source }`. The validator checks the total cost against `credits` (<= 1000), composition, every item against the type's equipment list, weapon slot limits (Unwieldy counts two) and that each fighter has at most one armour item. The engine's `GameSetup.gangs[seat].roster` is built from a starter gang by `src/data/roster.ts` (`rosterFromStarter`).

## 9. Zone Mortalis tiles and boards

Tile (`zm.schema.json#/$defs/tile`), tile-local coordinates in [-6, 6] (+z = the tile's "north" before rotation):

```json
{ "id": "zm.t.junction-a", "name": "Junction A",
  "walls":     [ { "id": "w1", "a": { "x": -6, "z": 2 }, "b": { "x": -1, "z": 2 }, "thickness": 0.5 } ],
  "doors":     [ { "id": "d1", "a": { "x": -1, "z": 2 }, "b": { "x": 1, "z": 2 }, "locked": false } ],
  "terminals": [ { "id": "t1", "door": "d1", "pos": { "x": 1.8, "z": 2.9 } } ],
  "ducts":     [ { "id": "u1", "a": { "x": 3, "z": -1.2 }, "b": { "x": 3, "z": 0.8 } } ],
  "obstacles": [ { "id": "o1", "kind": "barricade", "footprint": [ ... ] } ],
  "casketSpots": [ { "x": 0, "z": -3 } ],
  "floor": { "style": "grate" | "plate" | "hazard", "props": [ { "model": "pipes", "pos": { ... }, "yaw": 0 } ] },
  "source": "own design" }
```

Board (`zm.schema.json#/$defs/board`):

```json
{ "id": "zm.b.foundry-run", "name": "Foundry Run", "layout": "2x3",
  "tiles": [ { "tile": "zm.t.junction-a", "at": { "x": -6, "z": -12 }, "rot": 90 } ],
  "extra": { "walls": [], "doors": [], "terminals": [], "ducts": [], "obstacles": [], "caskets": [ { "x": 0, "z": 0 } ] },
  "scenarios": ["scn.tunnel-skirmish", "scn.smash-and-grab"],
  "source": "own design" }
```

- `layout`: `2x3` (24 x 36) or `brick7` (Forgotten Riches); `at` is the tile centre in board coordinates; `rot` in `0 | 90 | 180 | 270` (clockwise seen from above).
- Walls on a tile edge shared by two tiles are written once (on either tile); the board outline is added by `board.ts` as walls of the outer boundary.
- `board.ts` (engine) compiles a board into `BoardDef { size, outline, tiles: [{ id, rect }], walls: Polygon[], doors: [{ id, rect, segment, locked, terminals }], ducts, obstacles, casketSpots }`; the client draws from the same `BoardDef`, so what is drawn is what the rules measure.
- Validator checks (ZM-001, ZM-012): every tile shares at least half an edge with another; doors sit in wall gaps (both door ends touch a wall end or the outline); terminal within 1" of its door, one per side for a locked door; duct ends on opposite sides of a single wall with length <= 2"; nothing outside the outline; per board at least 3 doors, D6-worth of barricades (>= 1 authored, 3 recommended), 2 ductways, 2 casket spots at least 6" from every board edge; deployment regions of every listed scenario fit a full crew (10 fighters of 25 mm) without overlap.
- v1 ships at least three `2x3` boards and two `brick7` boards (owner may add more); tile art stays procedural.

## 10. Scenario (`scenario.schema.json`)

```json
{ "id": "scn.smash-and-grab", "name": "Smash & Grab",
  "layouts": ["2x3"],
  "roles": true,
  "crews": { "attacker": { "method": "custom", "x": 8 },
             "defender": { "method": "hybrid", "x": 3, "y": "D6" } },
  "crewCap": null,
  "deployment": { "kind": "standard", "minFromCentreline": 12, "defenderFirst": true },
  "caskets": { "count": 5, "placer": "defender", "region": "ownHalf", "minFromEdge": 4, "minApart": 6,
               "openBy": "attacker", "contents": "scn.smash-and-grab" },
  "scoring": [ { "on": "casketOpened", "seat": "attacker", "count": true } ],
  "victory": { "code": "smashAndGrabVictory" },
  "special": [],
  "text": "own-words briefing", "source": "Necrodamus N23 p306; 11-scenarios.md M-3" }
```

- `crews.*.method`: `custom | random | hybrid` with `x` (and `y` for hybrid; a DiceExpr); `both` instead of `attacker`/`defender` when there are no roles. `crewCap`: a 2D6 table (Forgotten Riches) `[{ min, max, cap }]`.
- `deployment.kind`: `standard | tile`; `caskets.region`: `ownHalf | centreTileFirst | anyTile` with placement rules; `contents`: `core` (R-15.11) or a scenario table id handled by a code hook.
- `scoring[]`: `{ on: fighterOutOfAction | fighterFled | casketOpened | casketSecured | lastGangStanding, seat?, points?: number | { byRole: {...} } | DiceExpr, count? }`; `victory`: `{ by: points | caskets }` or `CodeRef`; `special[]`: `CodeRef` list (`horrorsInTheDark`).

## 11. `{"code": ...}` escape hatch policy

1. Declarative first. A record uses `code` only when the effect vocabulary of section 7 cannot express the rule; adding a new declarative key is preferred when two or more records would share the code.
2. Shape: `{ "code": "<camelCaseName>", "params": { ... } }`, allowed in `skill.effect`, `rule.effect`, `wargear.effect`/`code`, `weapon.code`, `scenario.victory`, `scenario.special`, and `caskets.contents`. Never in characteristics, costs or weapon numbers.
3. Registration: every name is registered once in `src/engine/code-hooks.ts` (core and scenario hooks) or in `src/engine/gangs/<house>.ts` (house hooks, imported through `gangs/index.ts`), with a `params` validator. `CODE_HOOKS` is derived from the data at load time; `validate:data` fails on a name with no registration or on params the hook's validator refuses.
4. Proof: every registered hook has a test in `tests/engine/code-hooks.test.ts` (or the house's test file) that plays a real game fixture until the hook fires (`hookFireCount > 0`).
5. Hooks never raise decisions from lifecycle points; when a choice is needed they ask through `skill.choice` at the next decision point, as in Murder Squad.
6. A code hook that implements printed rules text records its source and a RULING line in `docs/needs-rules-check.md` when it interprets anything.

## 12. ajv plan and validation (`tools/validate-data.ts`)

- ajv 8 with `ajv-formats`, strict mode, `allErrors`; schemas registered by `$id` (`https://mancermundo.dev/schemas/<name>.schema.json`), `common.schema.json` referenced by `$ref`; `additionalProperties: false` on every object; `unevaluatedProperties: false` where `allOf` composes.
- Schema files (six, each with `$defs`; a data file validates against `<file>#/$defs/<record>`): `common.schema.json` (primitives, Condition, Effect, CodeRef), `core.schema.json` (action, dice, constants, trait), `item.schema.json` (weapon, wargear), `gang.schema.json` (house, fighterType, equipmentList, starterGang, skill, rule), `zm.schema.json` (tile, board), `scenario.schema.json`; plus `src/data/schema/index.ts` registering them. The manifest names the def each file uses.
- Checks after schema: unique ids across all files; every reference resolves (fighter type -> rules, equipment list, skill sets; starter gang -> types, weapons, wargear, skills; board -> tiles, scenarios; scenario -> boards of its layout); every trait known and implemented for v1 weapons; every code name registered with valid params; starter gangs legal and within credits; each fighter type has a figure archetype; board geometry checks of section 9; every weapon has a flavour; prose fields contain no text copied from sources (a spot check against `docs/sources/` extracts when present: any 12-word run shared with a source file is an error).
- Output: `ok (<n> records)` or `path: message` lines; non-zero exit on error. `tests/data/schemas.test.ts` runs the same validator, and `tests/data/gangs.test.ts` asserts the fighter-type counts and starter-gang rosters listed in `13-gangs.md`.
