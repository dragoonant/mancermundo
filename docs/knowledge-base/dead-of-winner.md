# Dead of Winner (Dead of Winter: A Crossroads Game port)

Folder: `C:\Claude Code Projects\Dead-of-winner`. Repo `dragoonant/dead-of-winner`, Pages https://dragoonant.github.io/dead-of-winner/ .

## 1. Overview
- 3D browser tabletop game: one human plays at a table of AI colonists, each with its own hand, secret objective and sometimes a betrayal. Port of *Dead of Winter: A Crossroads Game* (Plaid Hat Games, 2014), mechanics 1:1.
- Rules scope (base game): 2-5 seats (default 1 human plus 3 bots); 30 survivors, 39 items in 7 decks, 20 crisis cards, all 80 Crossroads cards, 10 main objectives (normal and hardcore), 27 secret-type objectives; start-screen variants (co-op, two-player, hardcore, betrayer, elimination, mature Crossroads). The Long Night, multiplayer and voiced table talk deferred to M9+.
- IP posture ("Mallet posture", 2026-10-09): real names OK; all prose in our own words from a one-line mechanical summary; no publisher art, icons or trade dress; unofficial fan project; rulebook PDFs and community data never committed; `tools/check-copied-text.ts` flags runs of 8+ shared words.
- Fairness pitch: bots see only `view(state, seat)`, roll the same seeded RNG, and the recap reveals every hidden decision; a leak test runs on every simulated game.

## 2. Stack and repo layout
- Vite 8, TypeScript 7, React 19.2, three 0.186, @react-three/fiber 9, drei 10, zustand 5; Vitest 5, Playwright, ajv, tsx, sharp; gltf-transform + meshoptimizer, lamejs. Fonts Bebas Neue and Crimson Text. Node 22.
- Top level: CLAUDE.md, HANDOFF.md, STATUS.md, PLAN.md, OWNER-REVIEW.md, README.md, `playwright.config.ts`, `vite.config.ts`, `.github/workflows/deploy.yml`, `.claude/launch.json` (dev server 5181). Secrets file gitignored via `tokens.txt*`.
- docs/: `DEAD-OF-WINTER-HANDOFF.md` (original brief, Parts A-K), `needs-rules-check.md` (196 RULING lines), `rulings-resolution.md`, `spec/00-architecture`, `10-rules-core`, `11-objectives`, `12-rules-test-checklist`, `13-golden-examples`, `20-data-schema`, `21-card-effects-dsl`, `30-art`, `40-ai`, `41-personas-and-talk`, `50-client`, `60-testing`, `spec/schemas/*.json`, `spec/sources/*-sources.md` (per-value source tables), gitignored `docs/sources/`.
- src/: engine about 8.9k lines, ai 3.1k, client 8.9k, data 0.6k plus JSON, tests 9.9k. 55 commits 2026-10-09 to 10-11.

## 3. Architecture
- Engine: pure, seeded, replayable; `step(state, action)` returns events, new state and exactly one `PendingDecision` with a `seat` (possibly `'all'` for votes); rejections never throw. Frozen after M0: `types, actions, events, hooks, rng, decider, view, index`. Public API: `createGame`, `step`, `validate`, `legalActions` (never empty), `replay`, `save/load`, `view`, `query.*` (crisis totals, food needed, exposure odds, kill odds, search odds, vote forecast). The engine owns every number the UI shows. Modules: `setup, decks, dice, exposure, survivors, zombies, crossroads, crisis, colony-phase, exile, objectives, effects, code-hooks, crossroads-hooks, bundles, actions/*, phases/*`. One generic mechanism per concept. Hidden information via `view(state, seat)`.
- Data: declarative JSON cards in the `21` effects DSL with `{"code": "<hook>"}` escape hatches (about 60 Crossroads hooks); ajv schema validation plus cross-record rules V-01..V-21, content-hashed bundles; the engine never imports data (bundle passed in). `tests/fixtures/bundle/` is a 12-survivor slice.
- AI: `createDecider(tier, persona, seed)`; tiers random, easy, normal, hard; planner `normal.ts` plus `normal/{plan,info,options,suspicion,votes,forecast,goals,reader}.ts` (dice knapsack, crisis contribution, colony forecast, objective goals, betrayer play parsing the card's own condition tree, log-odds suspicion ledger). Six personas with 63-71 own-words lines each. Tuning via env `AI_TUNE`; per-decision time budget behind an env var.
- Client: `store/gameStore.ts` is the only `step` caller; `presentation/` director and presented-state store (bots wait for presentation idle); `table/`, `figures/` (GLB loader, procedural fallback, gallery), `cards/` (faces from JSON), `dice/`, `ui/` (prompt dock, rails, start screen, recap), `vfx/` (snow, firelight, frost vignette, dice tumble), `audio/`, `bot/`, `recap/`, `testing/testHooks.ts`. Test hooks `?test=1`, `?seats=...&seed=`, `?gallery`, `?fps`, `?tier=`, `?variants=`. Vite chunks: title, react, engine, three, client; first load about 86 KB gzip.

## 4. Art pipeline
- Portraits, locations, title, items: Google Gemini through Claude in Chrome on the Windows PC, text-only prompts, one chat per batch of about 8. House style "desaturated cold winter palette, painterly realistic illustration, grounded and gritty, no text, no logos, no frames, no watermarks". Portraits 4:5 at 512x640 webp; locations 1280x720; title 1920x1080; items photographic still life 512x512. Prompt files `art/PROMPTS-gemini.md`, `art/PROMPTS-gemini-items.md`.
- Figures: first SDXL on the local RTX 5080 (4 seeds, 832x1216, 30 steps, CFG 6.5, IP-Adapter style ref at 0.25), archived. Replaced by Gemini full-body concepts from each card portrait (reference attached via hidden file input). Prompt: front three-quarter, "mildly stylized heroic proportions about four and a half heads tall... realistic not cute". Gemini first returned 6-7 head figures; text-only edits failed because Gemini keeps the attached image's composition; wording E worked: PIL squashes the body below the chin by 0.50-0.90, then Gemini repaints. Result 29 survivors at 4.2-5.3 heads. Then Hunyuan3D (cutout, shape, paint, finalize) outside the repo; one GLB per slug on a 30 mm base, about 1.2 in tall, about 6.1k triangles; `public/assets/models/manifest.json` (`heightIn`, `tris`); `tools/models/optimize.mjs` post-processes.
- Textures: `tools/textures/gen_textures.py` (Pillow/numpy, fixed seeds) generates 12 procedural textures.
- Shipped: 30 survivor GLBs, 4 zombie GLBs, 30 portraits, 39 item images, 7 locations, 1 title. Procedural capsule fallback when a GLB is missing. Board modelled procedurally so slots come from engine `capacity`; card faces rendered from JSON; own icons.

## 5. Audio pipeline
- ElevenLabs (key only via `ELEVENLABS_API_KEY`): SFX via sound-generation; voice via TTS `eleven_flash_v2_5` (narrator "Jacob Eder" plus persona voices); music `music_v1` instrumental mp3_44100_128.
- Tools: `tools/audio-content.ts` (authored prompts and lines), `audio-build-manifest.ts` (merges into `tools/audio-manifest.json` without overwriting hand edits; writes `src/client/audio/manifest.ts` and `public/sounds.html`), `gen-audio.ts` (idempotent, `--max-credits`, `--dry`, music opt-in), `compose-audio.ts`, `measure-audio.ts` (RMS/peak/crest in headless Chromium, writes `src/client/audio/trims.ts`, target RMS 0.165).
- Shipped: 174 mp3 in `public/audio` plus 6 music (about 51 SFX, 28 narrator/objective clips, 20 Crossroads narrations, 72 persona lines; music title, tension, colony-a/b, victory, defeat). Later persona lines are text-only (`voiced: false`); the client matches audio by exact line text.
- Code: `eventSounds.ts` maps events to sounds; manager with separate volumes; `presentAudio.ts`, `music.ts`.
- Prompt pattern: "describe the mechanism, state exclusions, promptInfluence 0.45-0.75, durations 0.5-1.5 s". Music about 12.5 credits/s; confirm past about 5k credits.

## 6. Testing, CI and deploy
- Vitest in `tests/{engine,ai,data,client}`, 458 tests named by checklist id (`EXPO-004`, `GOLD-001..006`, `OBJ-010`, `XRD-`, `VIEW-`, `AI-`).
- Sim `npm run sim -- --games N --seed S [--seats n]` with invariants after every step (NaN, one pending decision, legal actions validate, card conservation, morale range, 3000-decision cap, 200-decision stall detector, save/load round trip, replay determinism, hidden-information leak test per seat).
- `npm run bench:ai` (200 games per tier), `validate:data`, `check:copied`.
- Playwright e2e against the production build (`play.spec.ts` plays a whole game by clicking exact text), 4 workers, 90 s timeout (parallel WebGL pages starve each other).
- CI `deploy.yml`: `npm ci`, typecheck, test, build, Pages (Node 22). Sim, bench and e2e not in CI.

## 7. Milestone history and final state
M0 scaffold copied from Whirr Machine; M1 engine, random bot, sim with leak test; M2 content; M3 playable slice on Pages; M4 AI; card verification against Vassal module scans and a rules audit; M5 art (Gemini portraits, locations, title, figure concepts, items, 34 GLBs, restyle); M6 audio; M8 all 80 Crossroads; M7 polish (feed breakdowns, settings, recap story, variants); further M4 AI follow-ups. Last commit 2026-10-11 "M4: betrayer reader and exile votes for loyal bots".
Open: owner playtest; 5 betrayal card texts censored in the Vassal module; 72 rulings open; no recordings for 3 newer personas. AI bench misses: Normal completes the objective about 26% (target 35-50%), betrayer wins 8-11% (target 25-40%), exiles almost never called; tier ordering holds.

## 8. Lessons learned and gotchas
- "Playable first." "The AI colonists are the product." Lean mode by default; verify loops only for card data, AI colonists and when the owner asks. Rules ambiguities never block (`RULING:` lines, 196 at the end). "Do the legwork": fan wikis, photos, store listings count as sources; every value carries its source.
- Token rules: main loop writes Workflow scripts; agents return JSON of at most 300 tokens; each agent "owns ONLY" disjoint files; freeze interfaces before fan-out; concurrent agents never `npm install` or `git commit`; pages that block fetch (Fandom, BGG) are read once in a real browser into `docs/spec/sources/`.
- Token economy (2026-10-10): M0-M2 burned about 8M subagent tokens; after switching to Sonnet implementers, Opus integration only, no review loops and about 2.5M per push, M2 data + M3 client + M4 slim AI + balance shipped for about 1.8M total.
- Art: proportions in plain words, never "MGSD/SD/chibi/Gundam" in this project; never paste into Gemini from the clipboard; check head-to-height on every concept; text alone cannot shorten a body Gemini is editing (pre-squash the image); SDXL cannot hold an exact head ratio; Hunyuan style reference turns everything blue without `--style 0.2 --avoid`; decimate to about 6k triangles.
- Engine/AI: "The engine's exposure die is the whole game" (removing bites raises Normal completion 26% to 55%); about 35 constants swept and moved results less than noise, so don't over-tune; a new feature can lower benchmark numbers legitimately; bugs found by sim and e2e (held Crossroads card never looked at, lost replacement placement, hidden-id leak in the Gambling card).
- Engine rules: `legalActions` never empty; the UI never does rules maths; read targets from state, not events.
- Windows/tooling: PowerShell 5.1 writes JSON with a BOM; ElevenLabs 5xx is still charged (retry only 429); e2e needs 4 workers.
- Research routes: Vassal engine library (`vassalengine.org/api/gls/v1/projects/<slug>`, a .vmod is a zip of clean card scans) should be tried first for any board/card game; Bing image search via curl; Fandom MediaWiki API via curl with a browser UA; GitHub fan projects; eBay photos; PyMuPDF for PDFs.

## 9. Reusable pieces (relative to the project)
- Process: `CLAUDE.md`, `docs/DEAD-OF-WINTER-HANDOFF.md` Parts B, C, D, J, K, `tools/workflows/w1-engine.js` through `w4-ai.js`.
- Engine skeleton: `src/engine/{types,actions,events,hooks,rng,decider,view,index}.ts`, `docs/spec/00-architecture.md`, `docs/spec/21-card-effects-dsl.md`, `src/engine/effects.ts`, `code-hooks.ts`.
- Data tooling: `tools/validate-data.ts`, `src/data/index.ts`, `docs/spec/20-data-schema.md`, `docs/spec/schemas/`, `docs/spec/sources/*-sources.md` format.
- Sim/bench/leak: `tools/sim.ts`, `tools/sim-core.ts`, `tools/ai-bench.ts`, `docs/spec/60-testing.md`, `docs/spec/12-rules-test-checklist.md`.
- AI: `src/ai/index.ts`, `tiers.ts`, `normal/suspicion.ts`, `normal/votes.ts`, `normal/plan.ts`, `docs/spec/40-ai.md`, `41-personas-and-talk.md`.
- Client: `presentation/*`, `store/gameStore.ts`, `figures/{glbLoader,GlbBody,glbManifest,Gallery}`, `ui/promptModel.ts`, `PromptDock.tsx`, `vfx/*`, `testing/testHooks.ts`, `tests/e2e/{drive,policy}.ts`, `vite.config.ts`, `playwright.config.ts`, `deploy.yml`.
- Audio tools: `tools/gen-audio.ts`, `audio-build-manifest.ts`, `audio-content.ts`, `compose-audio.ts`, `measure-audio.ts`, `tools/audio-manifest.json`, `src/client/audio/*`, `public/sounds.html`.
- Art: `tools/models/optimize.mjs`, `tools/textures/gen_textures.py`, `art/PROMPTS-gemini*.md` (including proportion-edit wordings A-E), `docs/spec/30-art.md`.
