# Audio

Generated locally with the Audio Studio (`http://localhost:7890`: ACE-Step 1.5 music, Stable Audio Open SFX, Qwen3-TTS voice design). No ElevenLabs. Everything below is **not verified by ear**: it was built, measured and checked for loudness and crest factor only, so the owner should audition `public/sounds.html` and name ids to redo.

Licences: ACE-Step (Apache-2.0), Qwen3-TTS (Apache-2.0), Stable Audio Open (Stability community licence, fine for a free fan project). All prompts and lines are our own wording; no brand names are used in prompts.

## Regenerate

```
npx tsx tools/gen-audio.ts                          # everything missing (copies first, then generation)
npx tsx tools/gen-audio.ts --only wpn-auto-bolt-rifle music-title --force   # redo specific ids
npx tsx tools/gen-audio.ts --kind voice             # sfx | music | voice
npx tsx tools/gen-audio.ts --dry                    # print what would run
npx tsx tools/measure-audio.ts [prefix]             # RMS/peak/crest, rewrites public/audio/trims.json
```

- The studio must be up (`GET /api/status`, `comfy: ready`). Jobs run strictly one at a time; each wait is capped at 3 minutes (job cancelled, retried once). A 409 or "Server restarted" failure is retried once.
- Per item: post job, poll, download FLAC/WAV, decode (WAV in pure JS; FLAC through `ffmpeg` if on PATH, otherwise headless Chromium `decodeAudioData`; no ffmpeg is installed on this PC so Chromium is used), mono 44.1 kHz, trim leading silence (and trailing silence on short items), 15 ms fade-out (120 ms for music), loops get a 1.5 s equal-power crossfade, peak normalised to -1 dBFS, MP3 128 kbps mono (lamejs).
- Idempotent: an id whose `public/audio/<id>.mp3` exists is skipped unless `--force`. Seconds per generated id are logged in `tools/audio-src/gen-log.json`; `--keep-src` saves the raw studio file into `tools/audio-src/`.
- SFX use `mode: sfx` (50 steps, guidance 5, batch 1, 0.5-6 s; the ambience loop asks for 20 s). Music uses `mode: music` with empty lyrics (instrumental), 8 steps. Voice uses `mode: voice`, `model: qwen-design` with one invented narrator description and a fixed seed (40421) so the 12 lines share a timbre.
- Prompt lessons applied: describe the mechanism not the name, state exclusions ("no music, no voices"), gunshots as "single sharp transient crack, dry, percussive", marine death with helmet radio crackle and a long weighty collapse.
- Playback gains: `public/audio/trims.json` is a flat `id -> gain` map. Gain = min(target RMS / measured RMS, 1 / peak) with target 0.16 for effects and narration and 0.10 for music and ambience. Narrator lines are peak-limited, so they sit slightly under 0.16.

## Totals

82 ids: 29 copied from Mallet, 36 generated SFX, 12 narrator lines, 5 music tracks. Total audio length 419 s (7.0 min); about 365 s of it generated this run. `public/audio` is about 6.7 MB.

## Mallet mapping (copied, not regenerated)

Source folder is the sibling checkout `../Mallet-42k/public/audio/` (override with `MALLET_AUDIO_DIR`). `gen-audio.ts` copies these when the target is missing.

| Mancermundo id | Mallet file | Used for |
|---|---|---|
| `wpn-bolt-rifle` | `bolter-burst.mp3` | bolt rifle burst (also the fallback for any bolt weapon) |
| `wpn-bolt-pistol` | `wpn-bolt-pistol.mp3` | bolt pistol |
| `wpn-plasma-pistol` | `wpn-plasma-pistol.mp3` | plasma pistol standard |
| `wpn-hand-flamer` | `flamer.mp3` | hand flamer |
| `wpn-heavy-bolter` | `wpn-heavy-bolter.mp3` | heavy bolter |
| `wpn-grenade-launcher` | `wpn-grenade-launcher.mp3` | grenade launcher thump |
| `wpn-chainsword-rev` | `melee-chainsword.mp3` | chainsword rev |
| `wpn-power-fist` | `wpn-power-fist.mp3` | power fist |
| `wpn-power-weapon` | `wpn-power-weapon.mp3` | power weapon hum-slash |
| `wpn-slugga` | `wpn-slugga.mp3` | slugga |
| `wpn-dakka-shoota` | `shoota-spray.mp3` | dakka shoota rattle |
| `wpn-rokkit-launcha` | `wpn-rokkit-launcha.mp3` | rokkit launcha |
| `wpn-burna` | `wpn-heavy-flamer.mp3` | burna roar (Mallet heavy flamer) |
| `wpn-choppa` | `wpn-choppa.mp3` | choppa |
| `wpn-big-choppa` | `wpn-big-choppa.mp3` | big choppa |
| `wpn-power-klaw` | `power-klaw-crunch.mp3` | power klaw crunch |
| `hit-flesh` | `hit-impact.mp3` | hit flesh |
| `hit-armour` | `armour-save-clank.mp3` | hit armour / save clank |
| `death-marine-classic` | `death-space-marines.mp3` | alternate marine death (the generated death-marine is the primary) |
| `death-ork` | `death-orks.mp3` | ork death |
| `death-generic` | `model-death.mp3` | generic death fallback |
| `shout-ork` | `ork-war-cry.mp3` | ork war cry |
| `shout-marine` | `marine-shout.mp3` | marine shout |
| `ui-dice-rattle` | `dice-rattle.mp3` | dice rattle |
| `ui-dice-land` | `dice-land.mp3` | dice land |
| `ui-cp-gained` | `cp-gained-click.mp3` | CP gained |
| `ui-vp-scored` | `objective-captured-chime.mp3` | VP scored chime (very quiet source, trim gain is high) |
| `ui-defeat-sting` | `defeat-sting.mp3` | defeat sting |
| `amb-distant-battle` | `ambient-battlefield-loop.mp3` | distant battle loop |

Not copied: Mallet `wpn-boltgun.mp3` (owner-approved 4-round composite) and `wpn-storm-bolter.mp3` / `wpn-big-shoota.mp3`; `bolter-burst.mp3` was chosen for the bolt rifle because the brief named it. Swap by editing `copyFrom` in the manifest and rerunning with `--force --only <id>`.

## Id list

**Weapons: Angels of Death** (18): `wpn-bolt-rifle`, `wpn-auto-bolt-rifle`, `wpn-stalker-bolt-rifle`, `wpn-heavy-bolt-pistol`, `wpn-bolt-pistol`, `wpn-plasma-pistol`, `wpn-plasma-pistol-supercharge`, `wpn-hand-flamer`, `wpn-heavy-bolter`, `wpn-bolt-sniper-rifle`, `wpn-grenade-launcher`, `wpn-grenade-frag`, `wpn-grenade-krak`, `wpn-chainsword-rev`, `wpn-chainsword-hit`, `wpn-power-fist`, `wpn-power-weapon`, `wpn-thunder-hammer`

**Weapons: Kommandos** (17): `wpn-slugga`, `wpn-dakka-shoota`, `wpn-rokkit-launcha`, `wpn-burna`, `wpn-shokka-pistol`, `wpn-scoped-big-shoota`, `wpn-throwing-knives`, `wpn-choppa`, `wpn-big-choppa`, `wpn-power-klaw`, `wpn-breacha-ram`, `wpn-twin-choppas`, `wpn-grot-choppa`, `wpn-squig-bite`, `wpn-explosives`, `wpn-dynamite`, `wpn-harpoon`

**Impacts** (3): `hit-flesh`, `hit-armour`, `block-clang`

**Deaths and shouts** (9): `death-marine`, `death-marine-classic`, `death-ork`, `death-ork-roar`, `death-grot`, `death-squig`, `death-generic`, `shout-ork`, `shout-marine`

**Movement** (4): `move-marine-steps`, `move-ork-boots`, `move-climb`, `move-drop`

**UI and game-state stings** (12): `ui-dice-rattle`, `ui-dice-land`, `ui-order-engage`, `ui-order-conceal`, `ui-ap-spend`, `ui-cp-gained`, `ui-vp-scored`, `ui-marker-pickup`, `ui-turning-point-sting`, `ui-initiative-won`, `ui-victory-sting`, `ui-defeat-sting`

**Ambience (loops)** (2): `amb-industrial-wind`, `amb-distant-battle`

**Narrator** (12): `narr-turning-point-one`, `narr-strategy-phase`, `narr-firefight-phase`, `narr-initiative-aod`, `narr-initiative-kom`, `narr-operative-down`, `narr-objective-secured`, `narr-counteract`, `narr-final-turning-point`, `narr-victory`, `narr-defeat`, `narr-draw`

**Music** (5): `music-title`, `music-battle-a`, `music-battle-b`, `music-victory`, `music-defeat`

Weapon-flavour coverage (spec 13 §1.3 and §2.3): hand flamer, heavy bolt pistol, plasma pistol (standard, supercharge), auto bolt rifle, bolt rifle, stalker bolt rifle, grenade launcher (thump, frag, krak), bolt pistol, heavy bolter, bolt sniper rifle, chainsword (rev, hit), power fist, power weapon, thunder hammer; slugga, choppa, big choppa, power klaw, explosives, breacha ram, burna, shokka pistol, dakka shoota, rokkit launcha, scoped big shoota, throwing knives, twin choppas, grot choppa, squig bite, plus dynamite and harpoon. Fists use `hit-flesh`.

Narrator lines (own words): turning-point-one: "Turning point one."; strategy-phase: "Strategy phase."; firefight-phase: "Firefight phase."; initiative-aod: "Initiative to the Angels of Death."; initiative-kom: "Initiative to the Kommandos."; operative-down: "Operative down."; objective-secured: "Objective secured."; counteract: "Counteract."; final-turning-point: "Final turning point."; victory: "Victory."; defeat: "Defeat."; draw: "Draw.". Voice description: "a calm, kind and steady male narrator in his forties, warm low voice, clear measured delivery, serious and reassuring, slight military authority, studio quality".

## Measured loudness

RMS and peak are linear full-scale; crest = peak / RMS over the whole file (a gunshot wants about 6+; sustained bursts, flames and rockets are inherently lower). Gunshots flagged below 6 after one sharpened regeneration are listed under the table.

| id | seconds | RMS | peak | crest | trim gain |
|---|---|---|---|---|---|
| `amb-distant-battle` | 20.00 | 0.194 | 0.71 | 3.7 | 0.52 |
| `amb-industrial-wind` | 17.21 | 0.120 | 0.85 | 7.1 | 0.83 |
| `block-clang` | 1.52 | 0.059 | 1.00 | 16.9 | 1.00 |
| `death-generic` | 0.60 | 0.148 | 0.97 | 6.5 | 1.04 |
| `death-grot` | 1.52 | 0.109 | 1.00 | 9.1 | 1.00 |
| `death-marine` | 4.49 | 0.212 | 0.84 | 3.9 | 0.76 |
| `death-marine-classic` | 3.00 | 0.277 | 1.00 | 3.6 | 0.58 |
| `death-ork` | 1.60 | 0.366 | 1.00 | 2.7 | 0.44 |
| `death-ork-roar` | 3.58 | 0.134 | 0.88 | 6.5 | 1.14 |
| `death-squig` | 1.25 | 0.164 | 0.98 | 6.0 | 0.98 |
| `hit-armour` | 0.48 | 0.083 | 0.86 | 10.3 | 1.17 |
| `hit-flesh` | 0.48 | 0.231 | 1.00 | 4.3 | 0.69 |
| `move-climb` | 2.09 | 0.216 | 0.84 | 3.9 | 0.74 |
| `move-drop` | 1.80 | 0.317 | 0.86 | 2.7 | 0.51 |
| `move-marine-steps` | 3.08 | 0.102 | 0.87 | 8.5 | 1.15 |
| `move-ork-boots` | 0.78 | 0.083 | 0.90 | 10.8 | 1.11 |
| `music-battle-a` | 89.78 | 0.147 | 0.89 | 6.1 | 0.68 |
| `music-battle-b` | 90.04 | 0.166 | 0.85 | 5.1 | 0.60 |
| `music-defeat` | 9.72 | 0.131 | 0.85 | 6.5 | 0.77 |
| `music-title` | 60.03 | 0.128 | 0.92 | 7.2 | 0.78 |
| `music-victory` | 10.19 | 0.161 | 0.84 | 5.2 | 0.62 |
| `narr-counteract` | 1.10 | 0.078 | 0.84 | 10.8 | 1.18 |
| `narr-defeat` | 0.71 | 0.086 | 0.85 | 9.8 | 1.18 |
| `narr-draw` | 0.84 | 0.103 | 0.84 | 8.1 | 1.19 |
| `narr-final-turning-point` | 1.31 | 0.122 | 0.85 | 7.0 | 1.18 |
| `narr-firefight-phase` | 1.41 | 0.093 | 0.84 | 9.1 | 1.19 |
| `narr-initiative-aod` | 1.99 | 0.179 | 0.84 | 4.7 | 0.90 |
| `narr-initiative-kom` | 1.91 | 0.174 | 0.85 | 4.9 | 0.92 |
| `narr-objective-secured` | 1.28 | 0.114 | 0.84 | 7.4 | 1.18 |
| `narr-operative-down` | 1.15 | 0.120 | 0.84 | 7.0 | 1.18 |
| `narr-strategy-phase` | 0.97 | 0.082 | 0.84 | 10.3 | 1.18 |
| `narr-turning-point-one` | 1.28 | 0.189 | 0.85 | 4.5 | 0.85 |
| `narr-victory` | 1.38 | 0.066 | 0.85 | 12.8 | 1.18 |
| `shout-marine` | 1.00 | 0.259 | 1.00 | 3.9 | 0.62 |
| `shout-ork` | 1.20 | 0.359 | 1.00 | 2.8 | 0.45 |
| `ui-ap-spend` | 1.07 | 0.065 | 0.87 | 13.4 | 1.15 |
| `ui-cp-gained` | 0.48 | 0.034 | 0.58 | 16.9 | 1.72 |
| `ui-defeat-sting` | 1.48 | 0.084 | 0.69 | 8.2 | 1.45 |
| `ui-dice-land` | 0.48 | 0.026 | 0.95 | 35.8 | 1.06 |
| `ui-dice-rattle` | 0.80 | 0.069 | 1.00 | 14.5 | 1.00 |
| `ui-initiative-won` | 3.00 | 0.077 | 0.86 | 11.2 | 1.16 |
| `ui-marker-pickup` | 0.29 | 0.088 | 0.84 | 9.5 | 1.19 |
| `ui-order-conceal` | 1.07 | 0.136 | 0.85 | 6.2 | 1.18 |
| `ui-order-engage` | 1.07 | 0.147 | 0.84 | 5.7 | 1.09 |
| `ui-turning-point-sting` | 3.58 | 0.057 | 0.84 | 14.7 | 1.19 |
| `ui-victory-sting` | 5.04 | 0.166 | 0.84 | 5.1 | 0.97 |
| `ui-vp-scored` | 0.80 | 0.016 | 0.17 | 10.4 | 6.01 |
| `wpn-auto-bolt-rifle` | 1.96 | 0.122 | 0.95 | 7.8 | 1.05 |
| `wpn-big-choppa` | 1.00 | 0.282 | 1.00 | 3.6 | 0.57 |
| `wpn-bolt-pistol` | 0.80 | 0.111 | 0.80 | 7.2 | 1.25 |
| `wpn-bolt-rifle` | 0.89 | 0.118 | 1.00 | 8.4 | 1.00 |
| `wpn-bolt-sniper-rifle` | 1.52 | 0.087 | 1.00 | 11.5 | 1.00 |
| `wpn-breacha-ram` | 1.99 | 0.231 | 0.86 | 3.7 | 0.69 |
| `wpn-burna` | 1.76 | 0.440 | 1.00 | 2.3 | 0.36 |
| `wpn-chainsword-hit` | 2.53 | 0.154 | 0.88 | 5.7 | 1.04 |
| `wpn-chainsword-rev` | 3.00 | 0.206 | 1.00 | 4.9 | 0.78 |
| `wpn-choppa` | 0.80 | 0.200 | 1.00 | 5.0 | 0.80 |
| `wpn-dakka-shoota` | 0.68 | 0.311 | 1.00 | 3.2 | 0.52 |
| `wpn-dynamite` | 3.58 | 0.166 | 1.00 | 6.0 | 0.97 |
| `wpn-explosives` | 2.95 | 0.190 | 0.88 | 4.6 | 0.84 |
| `wpn-grenade-frag` | 3.00 | 0.143 | 1.00 | 7.0 | 1.00 |
| `wpn-grenade-krak` | 2.04 | 0.293 | 0.70 | 2.4 | 0.55 |
| `wpn-grenade-launcher` | 1.48 | 0.250 | 1.00 | 4.0 | 0.64 |
| `wpn-grot-choppa` | 1.25 | 0.038 | 0.86 | 22.5 | 1.17 |
| `wpn-hand-flamer` | 1.00 | 0.299 | 1.00 | 3.3 | 0.53 |
| `wpn-harpoon` | 2.53 | 0.180 | 0.83 | 4.6 | 0.89 |
| `wpn-heavy-bolt-pistol` | 1.10 | 0.077 | 0.83 | 10.7 | 1.21 |
| `wpn-heavy-bolter` | 1.48 | 0.467 | 1.00 | 2.1 | 0.34 |
| `wpn-plasma-pistol` | 1.00 | 0.259 | 1.00 | 3.9 | 0.62 |
| `wpn-plasma-pistol-supercharge` | 2.09 | 0.114 | 0.77 | 6.8 | 1.30 |
| `wpn-power-fist` | 1.00 | 0.194 | 1.00 | 5.2 | 0.83 |
| `wpn-power-klaw` | 0.68 | 0.092 | 0.54 | 5.9 | 1.75 |
| `wpn-power-weapon` | 0.88 | 0.155 | 1.00 | 6.4 | 1.00 |
| `wpn-rokkit-launcha` | 1.76 | 0.386 | 1.00 | 2.6 | 0.41 |
| `wpn-scoped-big-shoota` | 2.09 | 0.170 | 0.84 | 5.0 | 0.94 |
| `wpn-shokka-pistol` | 1.52 | 0.050 | 0.91 | 18.4 | 1.09 |
| `wpn-slugga` | 0.88 | 0.129 | 1.00 | 7.7 | 1.00 |
| `wpn-squig-bite` | 1.23 | 0.166 | 0.99 | 6.0 | 0.96 |
| `wpn-stalker-bolt-rifle` | 2.06 | 0.106 | 0.92 | 8.7 | 1.09 |
| `wpn-throwing-knives` | 1.04 | 0.120 | 1.00 | 8.3 | 1.00 |
| `wpn-thunder-hammer` | 3.00 | 0.172 | 0.81 | 4.7 | 0.93 |
| `wpn-twin-choppas` | 2.09 | 0.164 | 0.94 | 5.7 | 0.98 |

**Gunshots with crest < 6:** `wpn-dakka-shoota` (3.2, Mallet copy), `wpn-grenade-launcher` (4.0, Mallet copy), `wpn-heavy-bolter` (2.1, Mallet copy), `wpn-plasma-pistol` (3.9, Mallet copy), `wpn-rokkit-launcha` (2.6, Mallet copy), `wpn-scoped-big-shoota` (5.0, regenerated once, still low). The Mallet copies are sustained or explosive sounds (burst, rocket, flame-like) approved there and left as they are; `wpn-scoped-big-shoota` is a generated two-shot sound that stayed at 5.0 after one sharper-prompt retry. Re-roll with `--force --only wpn-scoped-big-shoota` if it sounds soft.

**Loudness outliers (trim gain <= 0.45 or >= 1.5):** `death-ork` (0.44), `shout-ork` (0.45), `ui-cp-gained` (1.72), `ui-vp-scored` (6.01), `wpn-burna` (0.36), `wpn-heavy-bolter` (0.34), `wpn-power-klaw` (1.75), `wpn-rokkit-launcha` (0.41).

## Not verified by ear

No human or model has listened to any of this. Likely trouble spots to check first: the narrator timbre across the 12 lines (one description and seed, but TTS can still drift), the ork and marine deaths against the Mallet versions, `music-victory` / `music-defeat` (ACE-Step short pieces can end early or fade out), the loop point of `amb-industrial-wind`, and `wpn-shokka-pistol` (crest 18, very quiet raw).
