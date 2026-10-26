# Not Enough Minerals (StarCraft: Tabletop Miniatures Game port)

Folder: `C:\Claude Code Projects\Not-Enough-Minerals` (research precursor: `C:\Claude Code Projects\StarCraft-TMG`).
Sources read for this entry: CLAUDE.md, HANDOFF.md, PLAN.md, STATUS.md, README.md, package.json, docs/KNOWLEDGE-BASE.md (sections 1-3, 7, 9, 10), docs/spec (00, 10, 50, 60, SC-SOURCES), art PROMPTS and REVIEW files, tools/out/music-report.md and m4-bench.md, file trees and git log. Specs 11-21 and 30, the 33 KB `docs/needs-rules-check.md` and the workflow scripts were not read in full.

## 1. Overview
- **Game:** a 3D browser version of *StarCraft: Tabletop Miniatures Game* (Archon Studio, licensed from Blizzard). Title is a pun. Credited to "evilgouki". 36x36 in table (skirmish) or 36x54 in (standard).
- **Rules scope:** mechanics ported 1:1. The Changelog 10.2026 and Cost Table 10.2026 override the Core Rules; the FAQ clarifies them.
- **Phases:** four per round (Movement, Assault, Combat, Scoring), alternating one-unit activations and Pass.
- **Combat:** D6 attack pipeline (Hit, Surge, Armour, Evade, damage carry-over), squads with coherency, a Supply pool with Reserves, one visibility mechanism for burrow, cloak and detection.
- **Content shipped:** 31 units across Terran, Zerg and Protoss, 64 upgrades, 112 abilities, 42 cards, 12 Mission Cards, 12 Deployment Cards, 39 keywords.
- **Opponent:** "the AI opponent is the product" (no official solo mode). Tiers random, easy, normal.
- **IP posture ("Mallet posture"):** real unit and card names allowed; all prose in our own words; no publisher art or logos (faction emblems and logo are original); unofficial-fan-project notice in README and UI; rulebook PDFs and community data never committed.
- **Timeline:** 33 commits 2026-10-13 to 2026-10-16. Reached M0-M4, M5 art, M6 audio, M7 polish, M8 terrain, M9 Wave 2.

## 2. Stack and repo layout
- Vite 8, React 19, @react-three/fiber 9, drei, three 0.186, zustand 5; TypeScript 7 strict, Vitest 5, Playwright, tsx; asset tooling gltf-transform, meshoptimizer, sharp, lamejs; Node 22. Pages base `/not-enough-minerals/`.
- Scripts: `dev`, `build`, `typecheck`, `test`, `e2e`, `sim`, `bench:ai`, `validate:data`, `models:optimize`.
- Folders: `src/engine` (pure TS, 38 modules), `src/ai`, `src/client`, `src/data`; `data/sc-2026-10/` (JSON: cards, costs, deployments, hooks, keywords, missions, units) and `data/editions.json`; `docs/spec/` (00 architecture, 10-19 rules, 20-21 data, 30 AI, 50 client, 60 testing) and `docs/KNOWLEDGE-BASE.md`; `docs/needs-rules-check.md` (RULING log); `tools/` (sim, ai-bench, validate-data, gen-audio/sfx/music, measure-audio, `models/`, `workflows/`, `out/`); `art/`, `public/`, `tests/`, `screenshots/`.
- Size: about 26.5k lines in `src`, 8.7k lines of tests.
- CLAUDE.md orders reading: HANDOFF.md, STATUS.md, PLAN.md, then only the spec sections a task names.

## 3. Architecture
**Engine (`src/engine`)**
- Pure TypeScript, seeded sfc32 RNG, no DOM. Exactly one `PendingDecision` with a `seat` that may be `'all'`.
- `legalActions` is never empty for an open decision. Bad input returns a `Rejection`; the engine never throws on it.
- Action kinds are `<namespace>.<verb>` (setup, turn, move, deploy, shoot, charge, melee, atk, ability, mission, score). One owner module per namespace; `registry.modules()` throws if two modules claim one.
- Contracts frozen after M1: `types`, `decider`, `view`, `rng`, `pending`. Changing them needs a matching edit to `docs/spec/00-architecture.md`.
- Deciders only receive `view(state, seat)` (hidden information stays hidden).
- All rules numbers come from `edition.ts`, which reads the data bundle and `rules.json`. `query.ts` supplies every number the UI or AI displays.
- Hooks: declarative JSON with `{"code": "<hook>"}` escape hatches; `HOOK_WIRING` lists call sites; 20 code hooks.
- "One generic mechanism per concept": one damage pipeline, one visibility model, one transport container, one reserve/arrival queue.

**Data:** schema `sc-2026-10` frozen after a dry run over every Founders Edition unit and card. Every record carries a `source`. `validate:data` ok with 15 by-design warnings.

**AI (`src/ai`)**
- Three tiers, utility scorer: `eval.ts`, `threat.ts`, `moves.ts` score the engine's own move/deploy/charge paths; no rules re-derived.
- `decider.ts` builds context from the view only and falls back to `random.ts` if an answer fails a check.
- Time budget (`AI_MS` / `VITE_AI_MS`, default 150 ms) maps to a deterministic work cap with a wall-clock hard stop.
- Client runs it in a Web Worker (`worker.ts`, `aiWorkerClient.ts`, `botDriver.ts`) with a 3 s timeout. Objectives are mission-aware.

**Client (`src/client`)**
- `contract.ts` is the only door to the engine; `store/gameStore.ts` is the only `apply` caller; the client never computes a rules number. Generic over factions and seats.
- Directories: `board/`, `figures/` (GLB with procedural fallback, `rig.ts` for turret yaw), `interaction/` (one prompt per decision kind), `presentation/` (director and beats pacing engine events), `dice/`, `audio/`, `vfx/`, `ui/`.
- Briefing modal, objective tracker, control rings and a first-turn hints strip shipped with the first playable.
- Test hooks: `?test=1` (exposes `window.__game`), `?seats=`, `?seed=`, `?tier=`, `?speed=`, `?matchup=`, `?mission=`, `?map=`, `?gallery`, `?fps`.

## 4. Art pipeline
**Figures (31 GLBs)**
1. Style: MGSD (super-deformed model-kit look), owner decision 2026-10-13: about 2-2.5 heads tall, huge head/helmet, stubby legs, oversized hands and weapons, Master Grade panel lines.
2. Concepts: Gemini (Pro) in Claude in Chrome on the Windows GPU PC, one chat per faction. First prompt attached the approved MGSD style image and a photo of the real miniature as shape references. Variants made by editing the previous image. Two-hue palette per faction so a hue-band recolour could work (Terran steel blue/gunmetal, Zerg violet/bone, Protoss gold/deep blue with cyan glow).
3. Prompt wording: "super-deformed SD Gundam style model kit figure (Bandai MGSD line)", "the helmet is the biggest part of the figure", "no lettering", "exactly ONE single figure, centred", round black base, white background.
4. SDXL fallback produced batch-3 concepts when Chrome was unreachable; later redone with Gemini.
5. 3D: Hunyuan3D (2.0 cutout and paint, 2.1 shape and finalize), local, then `tools/models/optimize.mjs` (meshopt).
6. Review: `art/models-staging/REVIEW.md` is a gate table per batch (concept head ratio, mesh faithfulness, ship or redo). Contact sheets checked before wiring.
7. Rigging: Siege Tank, Goliath, Hydralisk, Queen, Ravager and Omega Worm split into `lower`/`upper` nodes by `tools/models/split.mjs` and `split-planes.json`.

**Terrain (44 GLBs):** 44 slugs in four sets (outpost 12, temple 11, crystal 11, creep 10). Pipeline: Gemini concepts, cutout, shape, paint, `t_fit.py` (fits to rules footprint and grades textures), optimize. Scripts in `tools/models/terrain/`, prompts in `art/terrain/concepts/PROMPTS.md`. Terrain v1 was procedural and archived after the owner said it was "too simple and not shiny". Ground and HDRI textures are CC0 Poly Haven, recompressed to WebP (`art/board-textures/compress.mjs`, `public/assets/CREDITS.md`).

**Asset counts:** `public/models` 31 unit GLBs + manifest, 12 MB; `public/assets` 44 terrain GLBs + manifest, 14 ground/table WebPs, 1 HDR, 11 MB.

## 5. Audio pipeline
- SFX: 29 mp3s in `public/audio/sfx`, ElevenLabs sound-generation via `tools/gen-audio.ts` (idempotent, budget-capped), prompts in `tools/audio-manifest.json`, describing the mechanism not a brand name.
- Music: 4 mp3s (title 60 s, battle-1 120 s, victory 10 s, defeat 10 s), ElevenLabs `music_v1` via `tools/gen-music.ts`, forced instrumental, 2,500 credits of a 5k cap.
- Mixing: `tools/measure-audio.ts` (RMS, peak, crest) with trims in code (`SFX_TRIMS` in `sfx.ts`, music trims in `music.ts`). Music loops are decoded `AudioBuffer`s looped with `loopStart/loopEnd` to avoid the MP3 loop gap. A music director picks calm, battle, tense (3+ VP behind or last round), then victory/defeat stingers with crossfades; `tense` is the battle loop at 1.07x speed. `CUE_SOUND_TABLE` in `cueSounds.ts` maps engine cues to sounds; `weaponFlavour.ts` maps weapons to sound and VFX. `public/sounds.html` is an audition page.
- Key only via `ELEVENLABS_API_KEY` env var. Owner has not yet listened to `sounds.html` (loop seams and tense variant unconfirmed).

## 6. Testing, CI and deploy
- 555 Vitest tests in 60 files; engine test titles start with checklist IDs (`LOS-002 ...`). `golden.test.ts` follows the rulebook's learn-to-play battle.
- Sim: `tools/sim.ts` runs seeded random bots over real armies and rotating missions/deployments; invariants, replay determinism, 2000-decision stall cap, per-namespace coverage. 40/40 games finished, 0 errors; 100 mirror games no seat bias.
- AI bench: `tools/ai-bench.ts`, gate "bot beats random in at least 95%". Normal beat random 239/240; normal beat easy 201/240; mean decision 8.4 ms.
- E2E: 24 Playwright tests, run through msedge on this PC. Screenshots in `screenshots/` and `tools/out/review/`.
- CI `.github/workflows/deploy.yml`: `npm ci`, typecheck, unit tests, build, Pages deploy on push to `main`. No e2e, sim or bench in CI.

## 7. Milestone history and final state
- M0 (10-13): skeleton from Fell-in, specs, checklist, audio manager, music. M1: data schema frozen after dry run. M2: engine, sim 60/60. M3: playable client with MGSD figure batches 1-4. M4: utility AI (normal 99%, easy 97% vs random). M5: themed boards, 16 then 44 terrain models, skill popups. M8: terrain pass v2 (Hunyuan) on a second PC (RTX 3080 10 GB). M9 (10-16/17): engine wiring, Wave 2 armies, rules corrections, "Sunken Shrine" map.
- Final commit `80f57c3`. Typecheck clean, build OK, e2e passes, playable on Pages.
- Not yet: owner playtest gate for the AI and listen of `sounds.html`; turret yaw never seen live; first-weapon grants spent per action not per Batch; no standard-scale army presets; open AI items in `tools/out/ai-followups.md`.

## 8. Lessons learned and gotchas (project's own wording)
- Process: "Playable first"; lean mode by default, verify loops only for rules-dense data and the AI; rules ambiguities never block, log `RULING: <rule> | <what we did> | <why>` (ended 83 Confirmed, 50 Unsourced, 9 Corrected); freeze interfaces before fan-out and the data schema only after a dry run on every unit/card; each concurrent agent "owns ONLY" disjoint files; verify agents never edit; workflow agents return schema-validated JSON of 300 tokens or fewer; concurrent agents never `npm install` or `git commit`; per-decision AI budgets behind an env var from the start.
- KB mistakes: building from fan sources then redoing from the primary book; moving the project folder mid-workflow; appending to STATUS.md instead of rewriting; typing box scenarios from spec summaries so every one ended in a draw.
- Engine/AI: an empty `legalActions` froze the bot (twice in Mallet); zero-cost reactions loop forever (one reaction per window plus a stall cap); benchmark on a fixed mirror plus the box matchup; previews must match what the pipeline lands (Monte Carlo test).
- Art: never paste into Gemini from the clipboard (use the hidden file input); check the image's proportions, not the prompt (Gemini drifts to 6-7 heads; edit the base image instead); style reference images can turn a faction blue; state base ratio in capitals and the height ratio for terrain; Gemini terrain concepts beat SDXL ("12/12 usable"); Hunyuan paint flattens textures to pale tan (`t_fit.py` re-grades); on a 10 GB GPU shape needs `--offload` and fp16; `models:optimize` writes meshopt, so `GLTFLoader` needs the meshopt decoder or every GLB silently falls back; quadrupeds need per-unit yaw/height, check `?gallery`; Smart App Control once blocked textured weapon paint; Gemini caps around 30 images per evening; never run two GPU jobs at once.
- Audio: build the weapon-flavour map first; ship the measure tool and trims with the first batch; describe the mechanism, not the name; the music endpoint charged for a 502; confirm before more than about 5k credits.
- UI: ship briefings, objective tracker and control rings with the first playable; one shared Tooltip component, no native `title=` (enforced by `tests/client/noNativeTooltips.test.ts`); status icons should not jitter; the bot waits for animations.
- Hygiene: never commit the owner's real name or home path (grep before each commit); never commit PDFs, rules text or community data; workflow scripts stay LF.

## 9. Reusable pieces (paths relative to the project)
- Engine skeleton and contracts: `src/engine/{types,decider,view,rng,pending,registry,apply,errors}.ts`, `docs/spec/00-architecture.md`.
- Rules services: `dice.ts`, `effects.ts`, `hooks.ts`, `visibility.ts`, `geometry.ts`, `measure.ts`, `los.ts`, `squads.ts`.
- Tooling: `tools/sim.ts`, `tools/sim-core.ts`, `tools/ai-bench.ts`, `tools/validate-data.ts`, `tools/measure-audio.ts`, `gen-audio.ts`, `gen-music.ts`, `tools/workflows/m2-engine.js`, `m3-playable.js`, `m4-bot.js`.
- AI: `src/ai/{decider,worker,random,eval,threat,moves,policies}.ts`, `src/client/bot/{botDriver,aiWorkerClient}.ts`.
- Client: `src/client/contract.ts`, `store/gameStore.ts`, `presentation/{director,beats,cues}.ts`, `dice/`, `figures/{glbLoader,rig,manifest}.ts`, `board/terrainFit.ts`, `audio/{manager,music,sfx,cueSounds}.ts`, `weaponFlavour.ts`, `ui/Tooltip.tsx`.
- Art scripts: `tools/models/{optimize.mjs,split.mjs,split-planes.json}`, `tools/models/terrain/*`, `art/board-textures/compress.mjs`.
- Config: `vite.config.ts` (chunk splitting), `playwright.config.ts`, `.github/workflows/deploy.yml`, `.gitignore`, `.claude/launch.json`.
- Reference docs: `docs/KNOWLEDGE-BASE.md`, `docs/spec/60-testing.md`, `art/unit-concepts/PROMPTS.md`, `art/terrain/concepts/PROMPTS.md`.
- Hunyuan3D itself is not in the repo; HANDOFF.md documents its install on a second PC (pinned `transformers 4.48.3`, `diffusers 0.32.2`).

## 10. StarCraft-TMG folder
Pre-kickoff research and handoff folder, not a git repo: an earlier `HANDOFF.md`, an earlier `docs/KNOWLEDGE-BASE.md`, `docs/spec/sources/SC-SOURCES.md` (first-pass source map), `community/bsdata` (BattleScribe/New Recruit community data, cross-check only, never committed), `refs-local/` (miniature photo references plus an MGSD style image, never committed), and a gitignored secrets file. Not-Enough-Minerals is a superset of its docs; HANDOFF.md says to rename the folder to the chosen title before `git init`, which is how the game folder originated.
