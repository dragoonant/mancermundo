# Necromunda port: kickoff (2026-10-26)

Working title **Mancermundo** (folder `mancermundo`; Necromunda the way "Murder Squad" is Kill Team and "Mallet 42k" is Warhammer 40k). The knowledge base of every prior port is in [docs/knowledge-base/README.md](docs/knowledge-base/README.md). This file records the questions put to the owner and every decision with its reasoning, so any of them can be changed later.

## 1. What Necromunda is, in one paragraph
A skirmish between two underhive gangs of individual fighters (typically 5-15 a side) on a dense battlefield: Zone Mortalis (tile-based tunnels with walls and doors) or Sector Mechanicus (multi-level gantries). Each round has a Priority phase (roll for priority, ready all fighters), an Action phase of alternating fighter activations (two actions each), and an End phase (bottle tests, recovery of seriously injured fighters). Attacks roll to hit against BS/WS, to wound by Strength vs Toughness, armour saves modified by AP, then Injury dice decide flesh wound, seriously injured or out of action. Full primer: [docs/knowledge-base/necromunda-rules-primer.md](docs/knowledge-base/necromunda-rules-primer.md).

## 2. Insights from the knowledge base that shape this build
1. **Murder Squad is the template.** Kill Team and Necromunda both alternate single-figure activations with a small action budget, so Murder Squad's engine contract, firefight loop, movement/LoS/terrain code, AI framework (per-activation utility scoring in a worker), client, presentation director, dice tray and audio manager port directly. What does not port: defence dice and the Kill Team attack sequence (Necromunda rolls hit/wound/save like 40k, so Mallet 42k's wound-roll code is the reference), orders, CP/ploys, crit/tac ops, and all team data.
2. **Zone Mortalis is flat.** Walls and doors are procedural geometry; no Vantage floors or climbing in v1, which keeps LoS 2D-plus-height and movement simple.
3. **The lean recipe holds.** Copy sibling code, Sonnet implementers with exact file lists, one or two agents per milestone, session model only for the attack sequence, injuries and gang data; about 3M tokens to a playable build.

## 3. Owner's answers (2026-10-26, settled; do not re-ask)
| Question | Answer |
|---|---|
| First two gangs | **Goliath vs Escher** |
| Scope v1 | **Skirmish first**; campaign layer (XP, advancement, lasting injuries, territories) later |
| Battlefield | **Zone Mortalis first**; Sector Mechanicus later |
| Repo | **Public `dragoonant/mancermundo` with Pages**, pushes to `main` after each stage pre-approved |
| Gemini | **Unattended via Claude in Chrome**, downloads into the project pre-approved; no Flux/SDXL figure substitutes |
| GPU | Hunyuan3D and Audio Studio unattended, **this PC only** (not Alteisen) |
| Agents and budget | Subagents and Workflow runs OK, about **3M tokens** to the first playable |
| Rules sources | **Web research** into gitignored `docs/sources/`; ambiguities logged as RULING lines |
| Overnight prompts | Auto mode stays on; project `npm`/`pip` installs approved |

## 4. Decisions (defaults unless the owner changes them)
| Topic | Decision | Why |
|---|---|---|
| Edition | 2023 Necromunda Rulebook + current House of Chains / House of Blades lists + latest FAQ; 1:1 mechanics; own-words prose; real gang/fighter/weapon names | Same posture as Mallet and Murder Squad |
| Stack | Murder Squad M7 copied wholesale (Vite 8, React 19, R3F 9, zustand 5, TS 7, Vitest 5, Playwright, ajv) | Fastest path; the mobile layer, presentation and audio come with it |
| Engine shape | Murder Squad contracts and module split; rules modules rewritten: `priority` (was strategy), `action` phase (was firefight, two actions, no orders), `end` phase (bottle, recovery), `shoot`/`fight` with hit/wound/save and Injury dice, `traits` (was weapon rules), Zone Mortalis `terrain` (walls, doors) | Alternating activations already fit |
| Data | JSON per gang (`fighters`, `weapons`, `wargear`, `skills`, `house rules`), `source` per record, ajv schemas | Fidelity rule |
| Figures | Fresh MGSD body per fighter archetype, bare-handed with sockets; weapons as attachment GLBs; Murder Squad attachments reused where the weapon matches (chainsword, knives, flamer-type, pistols) | Owner's modular-figure direction from Murder Squad |
| Terrain | Procedural Zone Mortalis walls, doors and floor tiles with painted textures; props as Hunyuan GLBs if time allows | Image-to-3D cannot do flat terrain |
| Audio | Murder Squad's weapon sounds as the first batch; new SFX and underhive music via Audio Studio | Zero credit spend |
| AI | Murder Squad's utility decider re-scored for Necromunda (pinning, injuries, bottle) ; bench gate normal beats random >= 95% | AI is the product |

## 5. Milestones
| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold + specs | Repo, CI, Pages; `docs/spec/10..13`; checklist; leak list; `CLAUDE.md`, `PLAN.md`, `STATUS.md` |
| M1 | Data | Goliath and Escher fighters, weapons, wargear, skills, starter gangs; Zone Mortalis tiles and scenarios; `validate:data` clean |
| M2 | Engine | Priority/Action/End phases, every core action, shooting and close combat with traits, injuries, pinning, bottle tests, doors; sim 100 games 0 violations |
| M3 | Playable | Pages build vs bot with placeholder figures, briefing, dice tray, prompts, presentation |
| M4 | AI | Utility decider re-scored; bench >= 95% vs random |
| M5 | Look | Gemini concepts -> Hunyuan GLBs, ZM tiles and doors, gallery check |
| M6 | Sound | SFX/music via Audio Studio, `sounds.html` |
| M7 | Polish | hover help, settings, end screen, phone layout |
| M8+ | More | campaign layer, more houses, Sector Mechanicus |
