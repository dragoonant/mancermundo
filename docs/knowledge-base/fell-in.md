# Fell-in: Wasteland Warfair (Fallout: Wasteland Warfare port)

Folder: `C:\Claude Code Projects\Fell-in`. Repo `dragoonant/fell-in`, Pages `/fell-in/`.

## 1. Overview
- Unofficial fan port by "evilgouki" of **Fallout: Wasteland Warfare** (Modiphius, 1st edition). 3D browser skirmish game on a 36x36 in wasteland table.
- Rules scope (PLAN.md): v1 content is the Two Player Starter Set (Super Mutants vs Survivors, plus Brotherhood Aspirant, Deathclaw, starter creatures) with the box scenarios. Core mechanics (spec 10-16, 261 checklist IDs, about 40 rulings at M0): one d20 skill die plus coloured d12 effect dice; colour rulers instead of inches (engine stores inches and owns the colour table: Orange 2, Yellow 4, Red 6, Green 8, Blue 10, Black 12); alternating Ready/Use turns, 2 actions per activation, AP-bought quick actions, no facing; LOS and cover, damage, armor, radiation and conditions, charge and close combat, Prepare, Search, items, scenario objectives.
- Four opponent modes in order: own bot AI (versus), hot-seat, the official AI card system (solo and co-op), campaign/settlement (not built, M6).
- 16 scenarios by the last commit (GA tutorials, box 1-5, 7 AI/co-op). Brotherhood of Steel units added.
- Edition numbers (dice faces, rulers, costs) live in `data/1e/`, not code, so a 2nd-edition migration (expected November 2026) is a data change.
- IP posture ("Mallet posture", 2026-10-11): mechanics 1:1; unit, weapon and faction names may match; all prose in our own words from a one-line mechanical summary; no Modiphius/Bethesda art, icons or logos (Vault Boy, Pip-Boy, Nuka-Cola get original markings); rulebook and card PDFs never committed (`*.pdf`, `docs/sources/` gitignored).

## 2. Stack and repo layout
- Vite 8, React 19.2.8, three 0.186, @react-three/fiber 9, drei 10, zustand 5, TypeScript 7, Vitest 5, Playwright 1.63, tsx; tool deps `@gltf-transform/*`, `meshoptimizer`, `sharp`, `@breezystack/lamejs`. CI Node 22.
- Scripts: `dev`, `build`, `preview`, `typecheck`, `test`, `e2e`, `sim`, `bench:ai`, `validate:data`, `models:optimize`.
- Layout: CLAUDE.md, HANDOFF.md, STATUS.md, PLAN.md, README.md; `src/engine/` (about 7.5k lines), `src/ai/` (about 3.9k, plus `official/`), `src/client/` (about 7.1k), `src/data/` (about 0.7k); `data/1e/` (units, weapons, armor, items, mods, leaders, factions, scenarios, ai; `dice.json`, `rulers.json`, `rules.json`, `heroic.json`; `perks/` empty); `docs/spec/` (00-20, 30, 50, 60, `sources/`), `docs/needs-rules-check.md`, `docs/KNOWLEDGE-BASE.md`, `docs/audits/m4d-scenario-audit.json`; `tools/`, `tests/{engine,ai,client,e2e}`, `art/`, `public/assets/`, `screenshots/`, `sounds.html`.
- About 416 test cases (STATUS.md's "172 tests" is stale).
- Public assets: 54 GLBs (17 units, 17 weapons, 5 objects, 15 terrain), 3 WebP ground textures (Poly Haven Dry Ground 01, CC0), manifests and CREDITS. **No audio files exist.**

## 3. Architecture
**Engine (frozen contracts, `docs/spec/00-architecture.md`)**
- Pure TypeScript, no DOM, no `Math.random`. `apply(state, bundle, action)` validates and dispatches by the pending decision's namespace.
- Exactly one `PendingDecision` open at a time: `{id, seat, kind, context, options, canPass}`; `seat` may be `'all'`. `legalActions` never empty. Illegal input returns a `Rejection`, never throws. Seeded sfc32 RNG with action log for replay. Deciders receive only `view(state, seat)`.
- The engine owns every displayed number (hit odds, range band, cover, expected damage, kill odds via `src/engine/query.ts` or `pending.context`); the client only formats.
- Frozen after M1: `types`, `decider`, `view`, `rng`, `pending`.
- Rules protocol: `registry.ts` (ModuleDef per namespace) plus `apply.ts`. Modules: `turnflow`, `movement`, `attack`, `melee`, `damage`, `conditions`, `items`, `scenario`, `forces`, later `objects.ts`, `sides.ts`, `scenarios/{deploy,objshape,rules,spec,status}.ts`.
- Geometry, LOS, measure and terrain carried over from whirr-machine; heights and bases retuned (25/32/40 mm round, 50 mm Deathclaw).
- One generic mechanism per concept; declarative JSON with `{"code": "<hook>"}` escape hatches.

**Data:** schema frozen at M1 after a dry run encoding every starter-set card. `src/data/` loads via `import.meta.glob`; `npm run validate:data` runs the pure validator. Every record cites its source.

**AI**
- Versus bot (spec 30): `src/ai/{decider,eval,threat,nav,moves,policies,odds,world,worker}.ts`. Utility AI scoring candidate answers with engine-computed numbers; `world.ts` builds a query shim from the player view; tiers random/easy/normal; host re-validates every answer and falls back to random; runs in a Web Worker. Bench: normal 95-98% vs random over box-1..4, easy about 80%, about 25 ms per decision.
- Official AI (spec 18): `src/ai/official/{decider,matrix,targeting,responses,objectives,util,types}.ts`, built from the official Campaign Handbook (owner-supplied, gitignored PDF). Number tokens, blue-die row, matrix cells, responses A/M/O/F/D/S, Careful/Reckless, target priorities, seeded ties; logs an `ai.decision` per choice. Tests AI-001..031. `data/1e/ai/starter.json` has 3 cards from the handbook, 4 from card photos, 4 placeholders.

**Client (spec 50)**
- `store/gameStore.ts` is the only caller of apply. `bot/` (botDriver, randomBot, aiWorkerClient, officialBrain) drives bot seats. `presentation/` has `director.ts`, `cues.ts`, `presentedStore.ts`, `announceStore.ts`. `board/` (Canvas, Camera, Mat, Terrain, Zones, MarkerObjects, ObjectiveLabels, `terrainFit.ts`, `terrainGlb.ts`). `figures/` (`glbLoader`, `glbModels`, `GlbBody`, `Weapon`, `equipped`, `Procedural`, `Gallery`, `ObjectModels`). `interaction/`, `ui/` (StartScreen, HUD, Prompt, OddsPanel, AiCardPanel, Briefing, ObjectiveTracker, HowToPlay, EventFeed, GameOver), `dice/` (d20 plus d12 tray), `audio/` (`synth`, `manager`, `cueSounds`, `AudioHost`). `contract.ts` is the frozen client surface.
- Test hooks: `?test=1`, `?seats=human,bot&seed=`, `?gallery`, `?fps`, `?seats=human,official&scenario=ai-rr`; `window.__game` in test mode.

## 4. Art pipeline
The Windows PC with the GPU does all asset work; never the Mac, never the built-in browser for Gemini.
1. Concepts: Gemini via Claude in Chrome, one chat for figures, a second for weapons. Output `art/unit-concepts/<slug>.png`, `art/weapon-concepts/<slug>.png` (file name = GLB slug). Contact sheets in `art/figure-sheets/`, `art/terrain-sheets/`. Prompts in `art/unit-concepts/PROMPTS.md`.
2. 3D: local Hunyuan3D (shape, then paint). Terrain: SDXL concepts plus Hunyuan3D, decimated to about 6k triangles per piece. Stage scripts live outside the repo.
3. Optimise: `tools/models/optimize.mjs` (dedup, prune, weld, WebP textures at most 1024 px, meshopt).
4. Fit and wire: `public/assets/models/manifest.json` carries per-unit hand socket, yaw and height; terrain manifest `{file, size, rulesType}` mirrored in `src/engine/terrainCatalog.ts`.

Style (PROMPTS.md): "single miniature wargame figure: [DESCRIPTION]. Mildly stylized heroic proportions, about four and a half heads tall, detailed, not cute. Full body, neutral standing pose, front three-quarter view, both hands empty, right hand a loose empty fist as if gripping a handle, left arm relaxed. Standing on a plain round black base. Plain white background, even soft lighting, no shadows, no text, no logos." Follow-ups: "Same style, proportions, framing, base and background: now [DESCRIPTION]." Weapon prompt: single prop, exact side view, horizontal, barrel right, no hands, no text. CLAUDE.md bans "MGSD", "SD", "chibi", "Gundam", "mecha kit" in this project (numbers in plain words). Reference images go in through the hidden file input, never the clipboard.

**Key decision: figures are bare-handed; weapons are separate GLBs on a hand socket** (owner 2026-10-11). Weapons flat-tinted (paint stage blocked by Smart App Control). M4f pilot added two-handed poses (`units/<id>@long.glb`, `@heavy.glb`) with `hand` and `support` sockets for two units; M5 (2026-10-17) extended pose variants via `tools/local-gen/gen-poses.mjs` (Flux klein edit of the concept into the stance, Hunyuan via the local studios, sockets measured). True rigging rejected as unreliable on fused Hunyuan meshes.

## 5. Audio pipeline
- Shipped audio is fully procedural: `src/client/audio/synth.ts` (oscillator "tone" plus filtered-noise "hiss" recipes, `SOUND_IDS`, `RECIPES`, `MoodPlayer` for calm/battle music). `manager.ts`: sfx and music buses (music -14 dB under sfx), unlock on first click, volumes/mute in localStorage `fellin.audio.v1`, 35 ms retrigger gap, concurrency cap 4, about 35 cents pitch jitter, 1.8 s crossfades.
- `cueSounds.ts` maps cues to sounds; `weaponFlavour.ts` maps weapon id to flavour (pistol, rifle, shotgun, laser, plasma, explosive, blunt, blade, bite, claw) by longest-substring match, read by sound and VFX.
- `sounds.html` is an audition page (second Vite entry, ships on Pages) with one button per sound id and music buttons, for the owner to name ids to redo.
- ElevenLabs pipeline exists but produced nothing: `tools/gen-audio.ts` (idempotent, credit ceiling, `ELEVENLABS_API_KEY` env only), `compose-audio.ts`, `measure-audio.ts`, one-item `tools/audio-manifest.json` (narrator "Harry - Fierce Warrior").
- Since 2026-10-17 the owner directed audio toward the local Audio Studio (port 7890) instead of ElevenLabs; notes in `docs/spec/sources/LOCAL-STUDIOS.md`.

## 6. Testing, CI and deploy
- Vitest about 416 cases (`tests/engine` by checklist ID, `tests/ai`, `tests/client`, co-located data/ai/audio tests), 30 s timeout for slow CI.
- Headless sim `npm run sim -- --games N --seed s` with invariants; 50 random games 0 errors; `--official` finishes all 7 AI/co-op scenarios deterministically.
- Playwright e2e (home, play, briefing), Chromium, 4 workers, 90 s timeout, preview under `/fell-in/`, SwiftShader flags. One known failing test "activate, move by drag".
- CI `.github/workflows/deploy.yml`: `npm ci`, typecheck, unit tests, build, Pages deploy on push to `main` or manual dispatch. E2E local only.
- `vite.config.ts`: `base` `/fell-in/` in production only; chunks react, three, r3f, engine; 800 KB warning limit.
- Process: lean mode default (about 10 focused tests per stage), verify loops for AI and rules-dense data; workflow scripts in `tools/workflows/` (m1-data.js through m4f-pose-pilot.js) kept LF via `.gitattributes`, with a `COMMON` preamble, "You own ONLY" file ownership, result schemas `RESULT`, `VERDICT`, `FINDINGS`.

## 7. Milestone history and final state
25 commits 2026-10-11 to 10-13 (plus M5 on 10-17): M0 bootstrap from the whirr-machine skeleton, rules spec, M1 data schema and validator; M2 rules engine; M3 playable client, polish, terrain and unit figures (11 starter figures Gemini + Hunyuan, bare-handed with sockets; 17 weapon models), menu music, meshopt loading; M4a versus bot (normal 95% vs random); M4b official AI from the Campaign Handbook; M4c briefings, objective tracker, labels; M4d every scenario re-entered from its PDF, Brotherhood units, objective models, hold classes, How to play; M4f two-handed pose pilot; M5 pose variants and local-studio look/sound work.
Not done: M5 look-and-sound only partially (no narrator, no generated SFX in repo at the time of the 10-13 snapshot), M6 campaign/settlement, M7+ factions. Known gaps: official-AI edge rules, 4 placeholder AI cards, heavy-weapon hold untested, low bot objective weight pending playtest, box-5 has no rescue rule. HANDOFF.md carried stale "PAUSED" text that contradicted the git log.

## 8. Lessons learned and gotchas (quoted from the project)
- "quadrupeds made from side-view concepts face +/-x; the manifest now carries a per-unit `yaw` applied before the fit."
- "the raised empty fist is the figure's LEFT hand" (first socket estimates sat at the hip).
- "Natural attacks (bite/claw/swipe/crush) must draw nothing; the stand-in bar stuck out of the dogs."
- "Always check `?gallery` front and side close-ups before shipping figures; the overview camera hides all of this."
- "`models:optimize` writes `EXT_meshopt_compression`, so `GLTFLoader` must `.setMeshoptDecoder(MeshoptDecoder)`; without it every GLB silently fails and the procedural fallback shows."
- The in-app browser pane can lose WebGL rendering (blank canvas, no errors); use `npx playwright screenshot --wait-for-timeout=12000 <url> out.png`.
- A stale Vite server from another worktree on the same port served old code; give each worktree its own port.
- About 1 in 17 Gemini weapon replies came back as text; regenerate with "Generate an image:" up front.
- Gemini's first figure came out realistic (about 7 heads); "noticeably larger head, bigger hands and chunkier boots" fixed it.
- "Something the owner can open on Pages and play beats test coverage." "The AI opponent is the product." "Rules ambiguities never block work": `RULING: <rule> | <what we did> | <why>` with a status word (Confirmed, Corrected, Unsourced, Fan-source).
- Per-decision AI budgets behind an env var from the start. Freeze interfaces before fan-out; freeze the data schema only after a dry run on every unit in the first slice.
- Never write the owner's real name or home path into repo files. Concurrent agents never `npm install`, `git commit`, or edit `package.json`/`STATUS.md` unless told. Workflow scripts stay LF and `scriptPath` must be inside the repo. `resumeFromRunId` works only in the same session.
- Box scenarios typed from a spec summary "end in draws"; all were re-entered from the PDFs (M4d audit).
- Source research: Vassal modules first, then free official PDFs, fan-wiki APIs via curl with a browser user agent, GitHub fan projects, photos. Never ship a stand-in after one blocked source.
- Token economy: Sonnet implements, session model only for specs and adversarial verification, JSON returns of 300 tokens or fewer, about 2.5M tokens per push ceiling. Order: specs, engine, playable slice with procedural figures and random bot, AI, art, audio.

## 9. Reusable pieces (relative to the project)
- Deploy/config: `.github/workflows/deploy.yml`, `vite.config.ts` (chunk splitting, second `sounds.html` entry), `playwright.config.ts` (PW_PORT, SwiftShader, base), `.gitignore`, `.gitattributes`, `.claude/launch.json`.
- Process: `CLAUDE.md`, `tools/workflows/*.js` (for example `m4f-pose-pilot.js`), `docs/needs-rules-check.md` format, `docs/spec/sources/*` source-tag tables, checklist-ID test naming (`docs/spec/12-rules-test-checklist.md`).
- Engine contracts: `src/engine/{types,decider,view,rng,pending,registry,apply,query}.ts`, `docs/spec/00-architecture.md`.
- Skirmish geometry: `src/engine/{geometry,los,measure,terrain}.ts`. Dice/odds: `src/engine/dice.ts`.
- Data: `src/data/{bundle,types,validate}.ts`, `tools/validate-data.ts`, `docs/spec/20-data-schema.md`.
- Sim/bench: `tools/sim.ts`, `tools/ai-bench.ts`. AI: `src/ai/*`, `src/ai/official/*`.
- Client plumbing: `store/gameStore.ts`, `presentation/{director,cues,presentedStore}.ts`, `bot/botDriver.ts`, `interaction/*`, `dice/*`, `contract.ts`, `store/testHooks.ts`, `figures/Gallery.tsx`.
- GLB pipeline: `figures/{glbLoader,glbModels,GlbBody,Weapon,equipped}`, `board/{terrainFit,terrainGlb}.ts`, `tools/models/optimize.mjs`, `public/assets/models/manifest.json`, `tests/client/glb-pipeline.test.ts`; weapon poses `tools/local-gen/gen-poses.mjs`, `tools/local-gen/pose-batch.json`.
- Audio: `src/client/audio/{synth,manager,cueSounds,AudioHost}`, `weaponFlavour.ts`, `sounds.html`, `tools/{gen-audio,compose-audio,measure-audio}.ts`.
- Art prompts: `art/unit-concepts/PROMPTS.md`. Briefing/tutorial UI: `ui/{Briefing,HowToPlay,ObjectiveTracker}.tsx`, `briefingView.ts`, `howToPlayContent.ts`, `src/engine/scenarios/status.ts`.
- Cross-project lessons: `docs/KNOWLEDGE-BASE.md` (666 lines).
