# Whirr Machine (Warmachine MK4) and WarMechForge (BattleTech Classic)

Both are public GitHub Pages games by the same owner. WarMechForge copied Whirr Machine's process, config and client patterns. Neither repo has an `art/unit-concepts/PROMPTS.md`; concept prompts live in the handoff briefs and the Hunyuan folder outside the repos.

---

# Part 1: Whirr Machine

Repo `C:\Claude Code Projects\WarMForge\whirr-machine` -> github.com/dragoonant/whirr-machine, live https://dragoonant.github.io/whirr-machine/ . Secrets: `WarMForge\Tokens.txt` (`EL=<key>`), outside the repo.

## Overview
- Warmachine MK4 as a 3D browser game against an AI, mechanics 1:1. "Mallet posture" IP: names may match, all prose ours, no Steamforged art/icons/card text, reference photos outside the repo, unofficial fan project notice.
- Built: six factions (Cygnar, Khador, Trollbloods, Circle Orboros, Cryx, Protectorate of Menoth); Recon (30 pt, 36"x36") and Skirmish (50 pt, 48"x48"); focus warcasters plus warlocks with fury, leeching, frenzy, life spirals; soul and corpse tokens; command cards; all 7 Steamroller 2026 scenarios plus Random; optional deathclock; five themed boards; the AI plays all of it.
- Not built: several solo abilities, Defenses/Airdrop/Engineering cards, spell racking, Sniper before the roll, Bulldoze mid-move, multiplayer.
- 55 commits 2026-10-04 to 10-08, M0 to M13.
- Owner decisions (2026-10-04/05): title "Whirr Machine"; music via ElevenLabs Music (confirm before >~5k credits, overnight cap 25k); figures changed from "original SD designs" to MGSD versions of the REAL sculpts (official photos only as local refs, never in the repo); five themed boards picked at random per game with original terrain inspired by SFG packs; GPU work only when the owner says resume (later: from 00:00 local for overnight runs).

## Stack and repo layout
- Vite 8, TypeScript 7, React 19, three 0.186, R3F 9, drei 10, zustand 5, Vitest 5, Playwright 1.63, ajv, tsx, lamejs. Node 22. Scripts `dev build preview typecheck test e2e sim bench:ai validate:data`. `base` `/whirr-machine/` in production only. About 35k lines TS/TSX.
- `src/engine/`: frozen `types actions events hooks rng decider index`; `geometry los measure terrain`; `dice attack damage power-attacks`; `setup turnflow pending focus effects scenario`; `movement spells ambush targeted`; `code-hooks costs housekeeping`; `fury` and `phases/frenzy`; `cards card-effects clock scenario-rules`; `phases/{maintenance,control,activation,avenging,frenzy}`; `factions/{cygnar,khador,trollbloods,circle,cryx,menoth}`.
- `src/data/`: JSON plus `raw.ts`, `battlefields.ts`, `layout48.ts`, validated against `docs/spec/schemas/*.schema.json` (12 schemas).
- `src/ai/`: `decider tiers random plan roles moves deploy prob damage threat focus fury assassin cards scenario world edge worker`.
- `src/client/`: `App.tsx`, `GameScreen.tsx`, `contract.ts`, `weaponFlavour.ts`; `store board bot presentation interaction figures vfx audio dice clock ui` (ui has `start fury cards help prompts PaintPanel`).
- `tools/`: `sim.ts`, `ai-bench.ts`, `validate-data.ts`, `gen-audio.ts`, `compose-audio.ts`, `measure-audio.ts`, `audio-manifest.json`, `audio-src/`, `terrain-catalog.json`, `workflows/{w1-engine,w3-client,w4-ai,w5-art-polish,w6-audio,w8-terrain,w9-factions,w10-backlog}`.
- Tests: 98 files, 1167 unit tests; 10 Playwright specs (`art audio boards factions home m11 play skirmish steamroller terrain`, helper `policy.ts`).
- Docs: `CLAUDE.md`, `HANDOFF.md`, `PLAN.md`, `STATUS.md`, `README.md`; `docs/WARMACHINE-HANDOFF.md` (58 KB brief written from Mallet, Parts A-J), `docs/needs-rules-check.md` (109 KB), `docs/spec/{00-architecture,10-rules-core,11-scenarios,12-rules-test-checklist,13-golden-first-turn,20-data-schema,30-figures,40-ai,50-client,60-testing,70-terrain-boards,81-warlocks-fury,90-skirmish,90-skirmish-sources,91-cards-steamroller-clock}.md`, `spec/factions/<id>.md` plus `<id>-sources.md`, gitignored `docs/sources/`.

## Architecture
- Pure seeded reducer; exactly one `PendingDecision`; sfc32 RNG plus action log for replay/save/load; `legalActions` never empty; rejections with codes; `query.*` the only source of displayed numbers. Declarative JSON abilities with `{code: hookName}` escape hatches; one generic mechanism per concept (disabled -> boxed -> destroyed in `damage.ts`). Contract change log in `00-architecture.md` §14.
- AI: utility decider (random, easy, normal), closed-form 2d6 probabilities, threat maps, focus knapsack, assassination search, caster safety as a hard constraint, Web Worker with 2 s timeout. Normal beat random 20/20; after M13 beat Easy about 67-69%.
- Client: `store/gameStore.ts` only caller of `step`; `presentation/director.ts` events -> timed beats, bot answers only when presentation idle (5 s watchdog); prompts explain themselves with exact odds; ruler, LOS view, threat rings, grid card, dice tray, event feed, in-game army painter. `?test=1` exposes `window.__game`; `?gallery`, `?seed=`, `?board=`, `?size=skirmish`, `?fps`.

## Art pipeline
- Style "master grade SD", about 3 heads tall, not chibi; MGSD versions of the real starter sculpts from 2026-10-05.
- Concepts: Gemini via Claude in Chrome, one chat per faction, images pulled with in-page JS; reference photos in `..\refs-local\` outside the repo (`wm-*.png`, `gemini*`, `tanith/SOURCES.md`). Prompt template (brief D.2): description plus "master grade SD ... not chibi: about 3 heads tall ... plain round black base. No background (plain white), even soft lighting, no shadows, no text, no logos".
- 3D: local Hunyuan3D pipeline (`%USERPROFILE%\Hunyuan3D-2`, `-2.1`): SDXL or Gemini concepts -> `stage_cutout` -> `stage_shape` -> `stage_paint` -> `stage_finalize` (scales to inches, black base); about 10k faces, 1024 texture; about 90 s shape, 20 s paint. Concept prompts in `Hunyuan3D-2\wm_units.json` (slugs `wm-*`).
- Assets: 52 figure GLBs `public/assets/models/wm-*.glb` plus `manifest.json`, `m9-slugs.json`, `skirmish-slugs.json`; v1 archived. Army painter `glbPaint.ts` hue-band shader.
- Terrain: 35 `wt-*.glb` for five boards (bog, ruins, village, wasteland, outpost), decimated to about 6k triangles, from `tools/terrain-catalog.json` SDXL prompts ("unpainted grey resin 28mm wargame terrain piece... isolated, plain white background"); trench and ash flats procedural ("image-to-3D can't do flat terrain"). Ground mats `art/board-textures/gen.py`, `fetch.py` from CC0 Poly Haven; credits in `public/assets/terrain/CREDITS.md`. Contact sheets `art/figure-sheets`, `art/terrain-sheets`.
- Tanith was redone in M10 from real-sculpt photos. Weakest figures per STATUS: dozer-smigg, night-terror, dire-wolf cannon.

## Audio pipeline
- ElevenLabs (`ELEVENLABS_API_KEY` from `Tokens.txt`, `*.token*` gitignored). `tools/audio-manifest.json` 110 items `{id, kind, group, prompt|text, durationSeconds, promptInfluence, loop?}` mirrored in `src/client/audio/manifest.ts`; `gen-audio.ts` idempotent (delete the mp3 to redo). Voice "Harry - Fierce Warrior", `eleven_flash_v2_5`.
- Assets: 96 SFX/voice mp3s plus 14 music tracks in `music/` (`music_v1` instrumental: title a/b, battle a-a/a-b/b-a/b-b, victory a/b, defeat a/b, four faction themes); music about 12.5 credits/s; a 502 is still charged.
- Client `src/client/audio/{manager,eventSounds,beatAudio,trims,music}.ts`, `weaponFlavour.ts`; `tools/measure-audio.ts`; audition `public/sounds.html`. Prompt style: mechanism plus exclusions ("One heavy footfall of a huge steam-driven iron walking machine ... no music, no voices").

## Testing / CI / deploy
- CI `deploy.yml`: `npm ci`, typecheck, test, build, Pages; no e2e/validate/sim. Local gates typecheck, test, validate:data, then `sim` (50 games, spec 60 §2 invariants, 5000-decision cap, 200-decision stall detector, save/load and replay determinism; 50/50, 0 violations) and `bench:ai`.
- Engine tests by checklist ID (`ATK-012 ...`); golden test `tests/engine/golden.test.ts` replays the Quick Start turn with forced dice (GOLD-001); `tests/engine/action-fuzz.test.ts`. Playwright drives via `window.__game` and `data-testid`; screenshots `e2e-out/`.

## Milestone history and final state
M0 scaffold/CI/Pages, specs and contracts; M1/M2 geometry, LOS, rules core; M3 playable slice with procedural figures; M4 slam/trample, utility AI, exact previews; M5 Hunyuan figures, army painter, VFX, then real-sculpt figures; M6 SFX, narrator, music; M7 bot tier wiring, paint picker, figures face nearest enemy; M8 terrain and five boards, redo and decimation; M9 warlocks and fury plus four factions, army picker, ambient animation; M10 web-sourced stats; M11 in-game painter and drag movement; M12 Skirmish 50 pt, real Tanith; M13 command cards, Steamroller, clock, overnight backlog workflow. Final: M3-M13 done with gaps in M12/M13; 1167 tests pass. Open owner questions: Trollbloods starter has no MK4 box; Circle Skirmish list is 47 pt; some base sizes; single-source values.

## Lessons learned / gotchas (project's wording)
- "Something the owner can open on Pages and play beats test coverage." Lean by default (about 10 focused tests per stage); verify loops only for rules-dense content (each new faction).
- Token rules: main loop never reads whole source files; Sonnet implements, session model at `effort: 'high'` writes specs and verifies; one stage at a time, at most 8 agents; freeze interfaces before fan-out; cap research at 3-6 WebFetches; probe a new setup with one cheap agent first.
- Workflow pattern: `COMMON` preamble; schemas `RESULT`, `VERDICT`, `FINDINGS`; "You own ONLY: ..."; verify agents never edit; concurrent agents never `npm install` or `git commit`; stage files by exact path; run long commands in the foreground.
- Carried from Mallet: concurrent installs corrupted `node_modules`; bot acting ahead of animations; UI showing the previous roll's target (read targets from state); UI arithmetic ignoring cover; dice tray behind the prompt; one sound per weapon until a flavour map; Hunyuan style ref turns everything blue; floor-length capes break the base auto-cut; GLBs fused so recolouring needs the hue-band shader and loadouts need sockets; locking the figure look late threw away a whole v1 set; `legalActions` means "some candidate passes full validation"; AI deployment crashed in shallow zones (chain-deploy fallback).
- Edition guard: "Guard against MK3 leaking in (no facing, free strikes, STR or templates; melee range 1"; run is SPD+5")."
- Rulings never block: `RULING: rule | what we did | why` in `docs/needs-rules-check.md`.
- Data honesty: M9 stats marked unverified disappointed the owner, who considers finding the real information little extra effort (research several sources before any placeholder).
- Performance: game chunks about 1.1 MB; terrain at 12k triangles hurt frame time, decimated to 6k. CI about 2x slower (AI timing ceilings raised).

## Reusable pieces
`CLAUDE.md`; `tools/workflows/*.js`; `deploy.yml`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, `.gitattributes`, `.gitignore`; `src/engine/{rng,decider,index,types,actions,events,hooks}.ts`, `code-hooks.ts`, `damage.ts`; `src/ai/{prob,tiers,worker,decider,threat,focus,assassin}.ts`, `src/client/bot/{botDriver,aiWorkerClient}.ts`; `src/client/{store,presentation,dice,audio,figures,vfx}/`, `board/{frameRate,terrainFit,boards,Camera}`, `store/testHooks.ts`, `weaponFlavour.ts`, `figures/{glbModels,glbLoader,glbPaint,paintStore,Gallery}.tsx`; `tools/{sim,ai-bench,validate-data,gen-audio,compose-audio,measure-audio}.ts`, `tools/out/{fps-probe,console-probe}.mjs`; `tests/e2e/policy.ts`, `tests/engine/{golden,action-fuzz}.test.ts`, `tests/fixtures/synthetic-decisions.ts`; `public/sounds.html`, `art/board-textures/{gen,fetch}.py`; specs 00/30/40/50/60 as templates; `docs/WARMACHINE-HANDOFF.md` Parts B, C, D, I.

---

# Part 2: WarMechForge

Repo `C:\Claude Code Projects\WarMechForge\warmechforge` -> github.com/dragoonant/warmechforge, live https://dragoonant.github.io/warmechforge/ . Brief `WarMechForge\BATTLETECH-HANDOFF.md` (76 KB, also `docs/`). Secrets `WarMechForge\Tokens.txt` (`EL=`).

## Overview
- Classic hex-and-record-sheet BattleTech as the 2026 Core Box plays it (2026 Core Rules cut down; AGoAC rulebook text extract gitignored; Master Changelog v2 applied; 151 RULING lines). Owner does not own the Core Box, so variant stats were researched online with a `source` per value; box variants with no public stats replaced by public stock variants labelled "(stock)".
- Content: 8 Core Box chassis (Eris, Uziel, Solitaire, Rakshasa, Regent, Mad Cat Mk II, Vulture Mk IV, Hollander), 16 'Mechs; 4 Core Box maps plus a dev map; missions `intro.json`, `skirmish.json`; forces `intro-a`, `intro-b`, `mad-cat-lance`, `regent-lance`; Skirmish any-vs-any with BV, pilot skills, turn limit, forced withdrawal. Not built: other 4 box missions, weather, Beagle probe effects, smoke/hidden units, multiplayer.
- IP: real 'Mech/weapon/pilot names, all prose ours, no Catalyst/HBS art, logos, maps or record-sheet layouts; MegaMek data cross-check only.
- 18 commits, all 2026-10-08. Owner decisions (2026-10-07/08): BattleTech Classic hex rules (not Alpha Strike); figures = generated versions of the real sculpts with proportions stated in words (no MGSD/SD/chibi/Gundam words); SDXL/Gemini + Hunyuan3D + ElevenLabs; ElevenLabs about 25k credits total, confirm before >5k per run; multi-agent Workflows approved (<= 8 agents/stage, overnight auto OK). Figure gate approved: Solitaire/Regent look (close to the real sculpts, lightly stylised, olive/grey two-tone camo). Lesson: surface the figure gate prominently and early.

## Stack and repo layout
- Same stack and `package.json` as Whirr; about 27k lines.
- `src/engine/`: contracts; `hex los terrain`; `tohit hitloc cluster damage crits ammo`; `heat psr pilot`; `movement physical`; `equipment code-hooks`; `expect prob queries describe`; `machine` (phase machine), `phases/{end,heat,initiative,movement,physical,ranged}`, `initiative`, `deploy`; `scenario victory`; `bundles`.
- `src/data/`: `core/{ammo,equipment,spas,tables,weapons}.json`, `mechs/<chassis>/`, `maps`, `missions`, `forces`, `pilots`, `derive.ts`, `raw.ts`.
- `src/ai/`: `ctx damage decider fire heat moves order physical prob random threat tiers tune worker`.
- `src/client/`: `board` (hex tiles, water, props), `environment` (procedural "game shop" surroundings plus establishing shot), `figures` (`rig.ts`, `sockets.ts`), `interaction` (reach, path, facing, arcs, LOS, threat overlay), `presentation`, `audio`, `vfx`, `dice`, `bot`, `store`, `ui/` (`sheet` record-sheet pieces, `start`, `help`, move/fire/physical/heat/game-over panels).
- `tools/`: `sim.ts`, `invariants.ts`, `ai-bench.ts`, `validate-data.ts` (636 lines, tonnage audit, hook-wiring check), audio tools; workflows `w0-foundation w1-engine w3-client w4-ai w5-content w6-audio w7-polish w8-followups`.
- Tests: 58 files, 508 unit tests; 6 Playwright spec files, 12/12 passing. Docs: `CLAUDE.md` (with the "edition leak list"), `HANDOFF.md`, `PLAN.md`, `STATUS.md`, `README.md`, `CREDITS.md`; `docs/spec/{00-architecture (68 KB),10-rules-core (75 KB),11-missions,12-rules-test-checklist,13-golden,20-data-schema,30-figures,40-ai,50-client,60-testing,70-maps}.md`, 10 schemas, gitignored `docs/sources/`.
- Workspace root: `refs-local/` (product photos per chassis, `refs.json`), `sources-local/` (MegaMek `.board` files, `convert.mjs`, `post.mjs`), the rulebook PDF (never commit).

## Architecture
- Same engine philosophy: pure reducer, one pending decision, `legalActions` never empty and every member validates, `roll(state, spec)` the only RNG path, `query.*`/`describe.*` own displayed numbers; import boundary `data <- engine <- ai <- client` enforced by `tests/engine/boundaries.test.ts`.
- Hex geometry (`hex.ts`): axial/cube internally, `XXYY` labels, odd-q offset, facing 0 north clockwise, parity checked against MegaMek `Coords.java`; one world unit = one hex flat-to-flat.
- One damage pipeline (`damage.ts`), single heat ledger and PSR queue, simultaneous-damage windows, `expect.ts` previews match what the pipeline lands; equipment via hooks (PPC capacitor, coolant pod, MASC, RAC jam, Ultra AC, Guardian ECM); `validate-data` refuses unregistered hook names.
- AI: utility decider in a Web Worker (3 s timeout, random fallback), tiers random/easy/normal, per-location damage model with pKill, movement score with threat sampling, fire planner with heat knapsack, heat cap for normal; bench audits no-shot and back-to-threat moves.
- Client: same store/director/presented-state pattern; record sheet, heat scale, reach/path/facing, arcs, LOS lines, range rings, threat overlay, AI trace panel; `?gallery`, `?fps`, `?test=1`.

## Art pipeline
- Proportions (owner 2026-10-07): "mildly stylized heroic proportions, about 4-5 heads tall; cockpit and torso slightly enlarged, legs slightly shortened and sturdy, weapons slightly oversized; high surface detail like a premium painted tabletop miniature; keep the exact silhouette, weapon placement and panelling of the real sculpt." Banned words: MGSD, SD, super deformed, chibi, Gundam, mecha kit. Markings original (plain two-tone camo for the painter).
- Concepts: Gemini via Claude in Chrome ("Generate an image of the BattleTech [CHASSIS VARIANT] BattleMech exactly as in the attached photos ... Exactly ONE figure, centred, not cropped."), refs in `..\refs-local\<slug>\`; local SDXL fallback. 8 concepts `art/unit-concepts/bt-*`.
- 3D: Hunyuan3D driven by `bt_units.json`/`bt_picks.json`; scripts `run_bt_batch.sh`, `run_bt_one.sh`, `run_bt_final.py`, `split_mech.py` (splits GLB into `base`, `lower`, `upper` (hip pivot), `armL`, `armR` for torso twist and arm loss), `finalize_model.py`, `finalize_terrain.py`. 8 GLBs `public/assets/models/bt-<chassis>.glb` plus manifest; `art/figure-sheets/` 16 PNGs. Procedural fallback rig of boxes and cylinders (<= 600 triangles) on the same node contract.
- Textures: `art/board-textures/{gen,fetch,preview}.py` -> 4 board texture sets; CC0 HDRI for the shop; woods/rough/water procedural (no terrain GLBs).

## Audio pipeline
- Same ElevenLabs toolchain; `gen-audio.ts` options `--kind`, `--only`, `--dry`, env `CREDIT_CEILING`, `RUN_BUDGET`; manifest 75 items; 75 mp3s (65 SFX/voice: footsteps by weight class, twist, jump jets, fall, stand-up, 20 weapon flavours, physical attacks, damage, heat, UI; 11 narrator + 5 cockpit computer lines; SFX cost 756 credits) plus 10 music tracks (title 75 s, 2 battle loops 150 s, victory/defeat 12 s, each a/b; about 9.9k credits). Music direction: "gritty military-industrial orchestral, heavy synth bass, taiko and anvil percussion, low brass, a driving machine pulse, instrumental, no vocals, not imitating any existing film or game soundtrack."
- Client: master/sfx/voice/music buses, sfx limiter, music bus 14 dB lower, 2 s crossfades, ducking under voice, throttling with detune, `trims.ts`, `weaponFlavour.ts` test. Audition `public/sounds.html`; owner's a/b music picks pending.

## Testing / CI / deploy
- `deploy.yml` identical to Whirr. Gates (spec 60): G1 typecheck, G2 test, G3 validate:data, G4 sim 50 games, G5 AI bench, G6 Playwright `PW_PORT=4183`. Last results: 508 tests; validate 0 errors; sim 30/30 0 violations (`tools/invariants.ts` INV-01..20); bench normal 16/20 vs random (below the 18/20 target); Playwright 12/12.
- Test naming by checklist ID (`HEAT-014`; prefixes `INIT HEX MOVE LOS ARC TOHIT HITLOC CLUS DMG CRIT AMMO HEAT PSR PILOT PHYS EQUIP SCN BV`); golden GOLD-001..012 with forced dice; `action-fuzz.test.ts`; every code hook must have a test proving it fires in a real game. Playwright drags use `page.mouse` with >= 10 steps; specs fail on console errors. Bundle: main 469 kB, game 239 kB, three 995 kB, bot lazy.

## Milestone history and final state
M0 scaffold and specs; M1 pre-freeze fixes, hex/LOS/combat/damage/heat/PSR and slice data; M2 engine, random bot, sim, rulings; M3 playable slice; M4 utility AI in a worker; M5 full stock roster, maps, skirmish picker, GLB figures for all 8 chassis; M7 equipment rules, AI for full roster, threat overlay; M6 SFX, narrator, cockpit voice, make-up gain, redo of ph-dfa ("sounded like a cartoon whistle"), music; M8a equipment controls, Skirmish options, lance balance. Pending: figure-gate answer, music a/b picks, owner playtest, AI bench re-baseline, M8b smoke/hidden units. Known gaps: previews ignore crit chains, shared supporting variants, water sea-bed steps, Beagle probe no effect, `askDefender` never raised.

## Lessons learned / gotchas (project's wording)
- "Never ship a stand-in variant silently." "Do the legwork." "Research before assuming." Brief error: mapsheets are 16x17 not 15x17.
- Edition leak list in every rules prompt (Alpha Strike damage/ranges, HBS stability bar, MechWarrior ghost heat, TW/AGoAC leftovers, BMR crit edge cases).
- Carried from Whirr: abilities registered as plugins that core code never called (every code hook needs a firing test); targeted special actions auto-picked their target because `needsTarget` was a whitelist; empty `legalActions`, decision cap, stall detector; previous roll's target shown; dice tray behind the prompt; one 1.6 MB chunk; terrain at 12k tris (decimate to 6k); memoize hex geometry by hex pair.
- Art: "Gemini returned normal proportions when only a style label was given. State the proportions in numbers." "Locking the figure look late threw away a whole v1 set. Gate the proportions at M3." Make variants by editing one clean base image. Never paste refs via the clipboard (file-upload control instead).
- Secrets: Mallet's `.gitignore` had `*.token` but not `*.token*`; both repos now ignore `*.token*` and `Tokens.txt`.
- Bug found: `legalActions`/`query.reachable` empty when a 'Mech fell into a friendly hex (fix: "stand still" always available, stronger fuzz).
- Process: resume prompts say "check `git diff` first"; never stage `tools/out`, `e2e-out`, `test-results`, `.claude/`, `docs/sources/`, PDFs, photos, tokens; out-of-scope issues to `tools/out/m<n>-followups.md`. Bench caveat: a near-even matchup favours the weaker tier's side; use a fixed mirror.

## Reusable pieces
Same process/config set as Whirr. Hex specifics: `src/engine/{hex,los,tohit,hitloc,cluster,heat,psr,pilot,expect}.ts`; `src/client/interaction/{ThreatOverlay,HexFill,overlayModel}`; `src/client/board/{HexTiles,HexGrid,HexLabels,water,props}`, `src/client/environment/`; `src/client/figures/{rig,sockets,unitFrame,visuals}.ts`; `src/client/ui/sheet/*`, `HeatScale.tsx`, `FirePanel.tsx`, `MovePanel.tsx`, `PhysicalPanel.tsx`; `tools/invariants.ts`, `tools/validate-data.ts`, `tools/ai-bench.ts`; `..\sources-local\convert.mjs`; specs 00 (hex, damage and heat pipelines), 30 (node contract), 60 (gates, invariants), 70; Hunyuan `split_mech.py` for hip/arm splits; brief Parts C, D, I, G.0.
