# Audio

Generated locally with the Audio Studio (`http://localhost:7890`: ACE-Step 1.5 music, Stable Audio Open SFX, Qwen3-TTS voice design). No ElevenLabs. Everything below is **not verified by ear**: it was built, measured and checked for loudness and crest factor only, so the owner should audition `public/sounds.html` and name ids to redo.

Licences: ACE-Step (Apache-2.0), Qwen3-TTS (Apache-2.0), Stable Audio Open (Stability community licence, fine for a free fan project). All prompts and lines are our own wording; no brand names are used in prompts.

The project started from the Kill Team sibling's audio. The faction-specific parts (narrator lines, ork and marine barks and deaths, order stings, the old music) were deleted; the generic weapon, impact, UI and ambience sounds were kept under their old ids, and the Necromunda set was generated on top.

## Regenerate

```
npx tsx tools/gen-audio.ts                          # everything missing (copies first, then generation)
npx tsx tools/gen-audio.ts --only music-title music-tense --force   # redo specific ids
npx tsx tools/gen-audio.ts --kind voice             # sfx | music | voice
npx tsx tools/gen-audio.ts --dry                    # print what would run
npx tsx tools/measure-audio.ts [prefix]             # RMS/peak/crest, rewrites public/audio/trims.json + tools/audio-src/measure.json
npx tsx tools/build-sounds-page.ts                  # rebuilds public/sounds.html from the manifest + measure.json
```

- The studio must be up (`GET /api/status`). ComfyUI starts on the first music or SFX job, so `comfy: down` is normal and the first job is slow (about 60 s for a 90 s track). Jobs run strictly one at a time; each wait is capped at 5 minutes (job cancelled, retried once). A 409 or "Server restarted" failure is retried once.
- Per item: post job, poll, download FLAC/WAV, decode (WAV in pure JS; FLAC through `ffmpeg` if on PATH, otherwise headless Chromium `decodeAudioData`; no ffmpeg is installed on this PC so Chromium is used), mono 44.1 kHz, trim leading silence (and trailing silence on short items), 15 ms fade-out (120 ms for music), loops get a 1.5 s equal-power crossfade, peak normalised to -1 dBFS, MP3 128 kbps mono (lamejs).
- `candidates: N` in a manifest item asks the studio for N takes in one job (batch, max 4) and keeps the take with the highest crest factor. Used for gunshots and cracks.
- Idempotent: an id whose `public/audio/<id>.mp3` exists is skipped unless `--force`. Seconds per generated id are logged in `tools/audio-src/gen-log.json`; `--keep-src` saves the raw studio files into `tools/audio-src/`.
- SFX use `mode: sfx` (50 steps, guidance 5, 0.5-47 s; ambience loops ask for 31.5 s and come out about 29-30 s after the crossfade). Music uses `mode: music` with empty lyrics (the studio turns that into `[Instrumental]`), 8 steps, explicit bpm and key per track. Voice uses `mode: voice`, `model: qwen-design` with one invented announcer description and a fixed seed (40421) so the 11 lines share a timbre.
- Playback gains: `public/audio/trims.json` is a flat `id -> gain` map. Gain = min(target RMS / measured RMS, 1 / peak) with target 0.16 for effects and voice and 0.10 for music and ambience. Very spiky sounds (pistol shots, whip crack) are peak-limited and so sit quiet at playback; boost them in the mixer if they feel weak.

## Totals

84 ids, all present: 21 copied from the sibling Mallet checkout, the rest generated (6 music, 11 voice lines, 46 SFX). Total length 630 s (10.5 min). The Necromunda pass took about 9 GPU minutes (about 7.5 minutes of recorded job time plus ComfyUI start-up and the discarded gunshot re-rolls).

## Id list (stable; the client wiring is a later task)

**Music** (6): `music-title`, `music-battle-a`, `music-battle-b`, `music-tense`, `music-victory`, `music-defeat`

**Ambience (loops)** (4): `amb-industrial-wind`, `amb-distant-battle`, `amb-underhive-drips`, `amb-hive-hum`

**Voice (bookmaker announcer)** (11): `vo-take-positions`, `vo-priority-goliath`, `vo-priority-escher`, `vo-fighter-down`, `vo-out-of-action`, `vo-breaking`, `vo-bottle-test`, `vo-round-over`, `vo-goliath-hold`, `vo-escher-hold`, `vo-standoff`

**Zone Mortalis** (3): `zm-door-open`, `zm-door-close`, `zm-door-locked`

**Status and round cues** (5): `status-pinned`, `status-injured`, `status-out-of-action`, `bottle-test`, `ready-markers`

**Goliath flavour** (2): `gol-stimm`, `gol-roar-perc`

**Escher flavour** (2): `esc-chem-hiss`, `esc-whip-crack`

**UI and game-state stings** (11): `ui-dice-rattle`, `ui-dice-land`, `ui-ap-spend`, `ui-cp-gained`, `ui-vp-scored`, `ui-marker-pickup`, `ui-turning-point-sting`, `ui-initiative-won`, `ui-victory-sting`, `ui-defeat-sting`, `ui-priority`

**Weapons: guns** (15): `wpn-bolt-rifle`, `wpn-auto-bolt-rifle`, `wpn-stalker-bolt-rifle`, `wpn-heavy-bolt-pistol`, `wpn-bolt-pistol`, `wpn-plasma-pistol`, `wpn-plasma-pistol-supercharge`, `wpn-hand-flamer`, `wpn-heavy-bolter`, `wpn-bolt-sniper-rifle`, `wpn-slugga`, `wpn-dakka-shoota`, `wpn-burna`, `wpn-shokka-pistol`, `wpn-scoped-big-shoota`

**Weapons: explosives and heavy** (7): `wpn-grenade-launcher`, `wpn-grenade-frag`, `wpn-grenade-krak`, `wpn-rokkit-launcha`, `wpn-breacha-ram`, `wpn-explosives`, `wpn-dynamite`

**Weapons: melee** (10): `wpn-chainsword-rev`, `wpn-chainsword-hit`, `wpn-power-fist`, `wpn-power-weapon`, `wpn-thunder-hammer`, `wpn-throwing-knives`, `wpn-choppa`, `wpn-big-choppa`, `wpn-power-klaw`, `wpn-twin-choppas`

**Impacts** (3): `hit-flesh`, `hit-armour`, `block-clang`

**Deaths** (1): `death-generic`

**Movement** (4): `move-steps-heavy`, `move-steps-rubble`, `move-climb`, `move-drop`

Ids keep their Kill Team-era names where the sound is generic (for example `wpn-slugga` is a crude revolver shot, `wpn-burna` a flamer roar, `wpn-power-klaw` a power-fist crunch, `move-steps-heavy` heavy boots on grating). The weapon-specific pass (lasguns, needle guns, chem-throwers, renderizers and the rest) waits for gang data and will add new `wpn-*` ids instead of reusing these.

Voice lines (own words, rasping underhive bookmaker and announcer): `vo-take-positions`: "Gangs, take your positions."; `vo-priority-goliath`: "Priority goes to the Goliaths."; `vo-priority-escher`: "Priority goes to the Escher."; `vo-fighter-down`: "Fighter down!"; `vo-out-of-action`: "Out of action!"; `vo-breaking`: "They're breaking!"; `vo-bottle-test`: "Bottle test!"; `vo-round-over`: "Round over."; `vo-goliath-hold`: "The Goliaths hold the tunnels."; `vo-escher-hold`: "The Escher hold the tunnels."; `vo-standoff`: "Stand-off. Nobody wins in the underhive.".

Voice description: "a rasping, gravelly middle-aged male underhive bookmaker and fight announcer, hoarse smoky voice, sly showman delivery, slightly menacing and theatrical, clear diction, studio quality".

## Prompts policy

- Describe the mechanism, not the name ("a chemical injector gun pressed against skin with a sharp pneumatic hiss"). Never use brand or setting names in a prompt.
- Always append "no music, no voices" and pass a negative prompt. The default negative contains "hiss", so hiss sounds (`gol-stimm`, `esc-chem-hiss`) override it; ambience beds add "melody, drums, rhythm, gunshots, sudden loud events"; body-fall cues add "grunting, breathing".
- Gunshots and cracks: "single sharp transient crack, dry, percussive, close-miked, <what it is>", short duration (1-1.5 s), `candidates: 4`, and a crest check (target >= 8).
- Music: instrumental, a genre line plus instrument list, explicit bpm and key, "original composition, instrumental, no vocals". Loopable beds (`music-battle-a`, `music-battle-b`, `music-tense`) set `loop: true` for the tail-into-head crossfade.
- Voice: one description, one seed, short lines; punctuation drives delivery ("Fighter down!").

## Mallet copies (kept from the Kill Team era, not regenerated)

Source folder is the sibling checkout `../Mallet-42k/public/audio/` (override with `MALLET_AUDIO_DIR`). `gen-audio.ts` only copies when the target is missing, and every target already exists.

| Mancermundo id | Mallet file |
|---|---|
| `wpn-bolt-rifle` | `bolter-burst.mp3` |
| `wpn-hand-flamer` | `flamer.mp3` |
| `wpn-heavy-bolter` | `wpn-heavy-bolter.mp3` |
| `wpn-chainsword-rev` | `melee-chainsword.mp3` |
| `wpn-power-fist` | `wpn-power-fist.mp3` |
| `wpn-power-weapon` | `wpn-power-weapon.mp3` |
| `wpn-dakka-shoota` | `shoota-spray.mp3` |
| `wpn-rokkit-launcha` | `wpn-rokkit-launcha.mp3` |
| `wpn-burna` | `wpn-heavy-flamer.mp3` |
| `wpn-choppa` | `wpn-choppa.mp3` |
| `wpn-big-choppa` | `wpn-big-choppa.mp3` |
| `wpn-power-klaw` | `power-klaw-crunch.mp3` |
| `hit-flesh` | `hit-impact.mp3` |
| `hit-armour` | `armour-save-clank.mp3` |
| `death-generic` | `model-death.mp3` |
| `ui-dice-rattle` | `dice-rattle.mp3` |
| `ui-dice-land` | `dice-land.mp3` |
| `ui-cp-gained` | `cp-gained-click.mp3` |
| `ui-vp-scored` | `objective-captured-chime.mp3` |
| `ui-defeat-sting` | `defeat-sting.mp3` |
| `amb-distant-battle` | `ambient-battlefield-loop.mp3` |

## Measured loudness

RMS and peak are linear full-scale; crest = peak / RMS over the whole file. Gunshots want >= 8; sustained bursts, flames and rockets are inherently lower.

| id | seconds | RMS | peak | crest | trim gain |
|---|---|---|---|---|---|
| `amb-distant-battle` | 20.00 | 0.194 | 0.713 | 3.7 | 0.52 |
| `amb-hive-hum` | 30.01 | 0.280 | 0.847 | 3.0 | 0.36 |
| `amb-industrial-wind` | 17.21 | 0.120 | 0.848 | 7.1 | 0.83 |
| `amb-underhive-drips` | 29.20 | 0.154 | 0.84 | 5.5 | 0.65 |
| `block-clang` | 1.52 | 0.059 | 1 | 16.9 | 1 |
| `bottle-test` | 2.53 | 0.060 | 0.851 | 14.1 | 1.18 |
| `death-generic` | 0.60 | 0.148 | 0.966 | 6.5 | 1.04 |
| `esc-chem-hiss` | 2.09 | 0.139 | 0.715 | 5.1 | 1.15 |
| `esc-whip-crack` | 1.33 | 0.027 | 1 | 36.8 | 1 |
| `gol-roar-perc` | 1.62 | 0.131 | 0.841 | 6.4 | 1.19 |
| `gol-stimm` | 1.33 | 0.166 | 1 | 6.0 | 0.96 |
| `hit-armour` | 0.48 | 0.083 | 0.856 | 10.3 | 1.17 |
| `hit-flesh` | 0.48 | 0.231 | 1 | 4.3 | 0.69 |
| `move-climb` | 2.09 | 0.216 | 0.84 | 3.9 | 0.74 |
| `move-drop` | 1.80 | 0.317 | 0.857 | 2.7 | 0.51 |
| `move-steps-heavy` | 3.08 | 0.102 | 0.867 | 8.5 | 1.15 |
| `move-steps-rubble` | 0.78 | 0.083 | 0.899 | 10.8 | 1.11 |
| `music-battle-a` | 116.66 | 0.149 | 0.82 | 5.5 | 0.67 |
| `music-battle-b` | 118.49 | 0.141 | 1 | 7.1 | 0.71 |
| `music-defeat` | 7.99 | 0.091 | 0.847 | 9.3 | 1.09 |
| `music-tense` | 58.51 | 0.107 | 0.847 | 7.9 | 0.93 |
| `music-title` | 90.02 | 0.106 | 0.847 | 8.0 | 0.94 |
| `music-victory` | 9.85 | 0.176 | 0.861 | 4.9 | 0.57 |
| `ready-markers` | 1.25 | 0.044 | 1 | 22.6 | 1 |
| `status-injured` | 1.20 | 0.170 | 0.764 | 4.5 | 0.94 |
| `status-out-of-action` | 1.70 | 0.197 | 1 | 5.1 | 0.81 |
| `status-pinned` | 1.52 | 0.059 | 0.95 | 16.2 | 1.05 |
| `ui-ap-spend` | 1.07 | 0.065 | 0.866 | 13.4 | 1.15 |
| `ui-cp-gained` | 0.48 | 0.034 | 0.581 | 16.9 | 1.72 |
| `ui-defeat-sting` | 1.48 | 0.084 | 0.691 | 8.2 | 1.45 |
| `ui-dice-land` | 0.48 | 0.026 | 0.946 | 35.8 | 1.06 |
| `ui-dice-rattle` | 0.80 | 0.069 | 1 | 14.5 | 1 |
| `ui-initiative-won` | 3.00 | 0.077 | 0.86 | 11.2 | 1.16 |
| `ui-marker-pickup` | 0.29 | 0.088 | 0.839 | 9.5 | 1.19 |
| `ui-priority` | 1.80 | 0.195 | 0.847 | 4.3 | 0.82 |
| `ui-turning-point-sting` | 3.58 | 0.057 | 0.841 | 14.7 | 1.19 |
| `ui-victory-sting` | 5.04 | 0.166 | 0.838 | 5.1 | 0.97 |
| `ui-vp-scored` | 0.80 | 0.016 | 0.166 | 10.4 | 6.01 |
| `vo-bottle-test` | 1.36 | 0.145 | 0.847 | 5.8 | 1.1 |
| `vo-breaking` | 1.46 | 0.160 | 0.85 | 5.3 | 1 |
| `vo-escher-hold` | 1.75 | 0.120 | 0.847 | 7.1 | 1.18 |
| `vo-fighter-down` | 1.54 | 0.142 | 0.84 | 5.9 | 1.13 |
| `vo-goliath-hold` | 2.61 | 0.163 | 0.841 | 5.2 | 0.98 |
| `vo-out-of-action` | 1.49 | 0.129 | 0.822 | 6.4 | 1.22 |
| `vo-priority-escher` | 2.53 | 0.120 | 0.839 | 7.0 | 1.19 |
| `vo-priority-goliath` | 3.74 | 0.170 | 0.842 | 5.0 | 0.94 |
| `vo-round-over` | 2.09 | 0.160 | 0.841 | 5.3 | 1 |
| `vo-standoff` | 3.68 | 0.114 | 0.847 | 7.4 | 1.18 |
| `vo-take-positions` | 2.19 | 0.134 | 0.85 | 6.4 | 1.18 |
| `wpn-auto-bolt-rifle` | 2.53 | 0.095 | 0.92 | 9.7 | 1.09 |
| `wpn-big-choppa` | 1.00 | 0.282 | 1 | 3.6 | 0.57 |
| `wpn-bolt-pistol` | 1.23 | 0.024 | 0.956 | 40.2 | 1.05 |
| `wpn-bolt-rifle` | 0.89 | 0.118 | 1 | 8.4 | 1 |
| `wpn-bolt-sniper-rifle` | 1.52 | 0.087 | 1 | 11.5 | 1 |
| `wpn-breacha-ram` | 1.99 | 0.231 | 0.862 | 3.7 | 0.69 |
| `wpn-burna` | 1.76 | 0.440 | 1 | 2.3 | 0.36 |
| `wpn-chainsword-hit` | 2.53 | 0.154 | 0.876 | 5.7 | 1.04 |
| `wpn-chainsword-rev` | 3.00 | 0.206 | 1 | 4.9 | 0.78 |
| `wpn-choppa` | 0.80 | 0.200 | 1 | 5.0 | 0.8 |
| `wpn-dakka-shoota` | 0.68 | 0.311 | 1 | 3.2 | 0.52 |
| `wpn-dynamite` | 3.58 | 0.166 | 1 | 6.0 | 0.97 |
| `wpn-explosives` | 2.95 | 0.190 | 0.876 | 4.6 | 0.84 |
| `wpn-grenade-frag` | 3.00 | 0.143 | 1 | 7.0 | 1 |
| `wpn-grenade-krak` | 2.04 | 0.293 | 0.697 | 2.4 | 0.55 |
| `wpn-grenade-launcher` | 1.52 | 0.053 | 0.855 | 16.1 | 1.17 |
| `wpn-hand-flamer` | 1.00 | 0.299 | 1 | 3.3 | 0.53 |
| `wpn-heavy-bolt-pistol` | 1.10 | 0.077 | 0.826 | 10.7 | 1.21 |
| `wpn-heavy-bolter` | 1.48 | 0.467 | 1 | 2.1 | 0.34 |
| `wpn-plasma-pistol` | 1.25 | 0.015 | 0.849 | 54.6 | 1.18 |
| `wpn-plasma-pistol-supercharge` | 1.52 | 0.027 | 0.853 | 32.1 | 1.17 |
| `wpn-power-fist` | 1.00 | 0.194 | 1 | 5.2 | 0.83 |
| `wpn-power-klaw` | 0.68 | 0.092 | 0.54 | 5.9 | 1.75 |
| `wpn-power-weapon` | 0.88 | 0.155 | 1 | 6.4 | 1 |
| `wpn-rokkit-launcha` | 1.76 | 0.386 | 1 | 2.6 | 0.41 |
| `wpn-scoped-big-shoota` | 2.06 | 0.087 | 1 | 11.5 | 1 |
| `wpn-shokka-pistol` | 1.52 | 0.050 | 0.914 | 18.4 | 1.09 |
| `wpn-slugga` | 0.99 | 0.054 | 0.845 | 15.5 | 1.18 |
| `wpn-stalker-bolt-rifle` | 2.06 | 0.106 | 0.915 | 8.7 | 1.09 |
| `wpn-throwing-knives` | 1.04 | 0.120 | 1 | 8.3 | 1 |
| `wpn-thunder-hammer` | 3.00 | 0.172 | 0.814 | 4.7 | 0.93 |
| `wpn-twin-choppas` | 2.09 | 0.164 | 0.94 | 5.7 | 0.98 |
| `zm-door-close` | 3.58 | 0.115 | 0.941 | 8.2 | 1.06 |
| `zm-door-locked` | 1.52 | 0.238 | 0.754 | 3.2 | 0.67 |
| `zm-door-open` | 3.40 | 0.166 | 0.864 | 5.2 | 0.97 |

## Gaps and known weak spots

- **Gunshot crest < 8:** `wpn-dakka-shoota` (3.2), `wpn-heavy-bolter` (2.1), `wpn-rokkit-launcha` (2.6). These are sustained bursts or rockets (Mallet copies) where crest is inherently low; they were left as they are. The single-shot guns (`wpn-bolt-pistol`, `wpn-slugga`, `wpn-plasma-pistol`, `wpn-plasma-pistol-supercharge`, `wpn-grenade-launcher`, `wpn-scoped-big-shoota`, `wpn-auto-bolt-rifle`) were regenerated from scratch with 4 takes each and now measure 9.7 to 54. Crests above about 30 mean a very short spike in a mostly quiet file, so they may sound thin or tiny: listen first.
- `esc-whip-crack` crest is 36.8 with RMS 0.027 (the best of 4 takes), same caveat.
- No weapon-specific Necromunda sounds yet (lasgun, needle gun, chem-thrower, renderizer, shotgun, autogun variants, stubber, plasma gun and so on); no per-gang footsteps; no gang-specific deaths (only `death-generic` and `status-out-of-action`); no ricochet or bullet-whiz; no door-breach (`wpn-breacha-ram` is the closest); no crowd or bookmaker ambience.
- `music-victory` (9.8 s) and `music-defeat` (8.0 s) came out shorter than the 15 s and 12 s requested; ACE-Step ends short pieces early and the tail silence is trimmed.
- `ui-vp-scored` and `ui-cp-gained` are very quiet Mallet files with high trim gains; `ui-vp-scored` is Kill Team scoring flavour and may be dropped.
- Kill Team-era ids that no longer exist: all `narr-*`, `shout-*`, `death-marine*`, `death-ork*`, `death-grot`, `death-squig`, `ui-order-*`, `wpn-squig-bite`, `wpn-grot-choppa`, `wpn-harpoon`; `move-marine-steps` and `move-ork-boots` were renamed `move-steps-heavy` and `move-steps-rubble`. `src/client/audio/ids.ts` still lists the old ids and needs updating in the wiring task.

## Lessons

- ComfyUI starts on the first music or SFX job; the old "wait until comfy is ready" guard in `gen-audio.ts` would have deadlocked. A cold first 90 s music job took 61 s; warm 120 s tracks took 15 s.
- The Stable Audio Open batch parameter (up to 4 takes per job) costs almost nothing extra and is the cheapest fix for gunshot crest: takes from one prompt ranged from 3.4 to 54 crest. Pick by measured crest instead of rewording prompts.
- Asking for "extremely sharp, instant attack, no rising whine" in the prompt lifted a stubborn plasma shot from 3.6-5.4 to 14-31 crest.
- A tiny gunshot can have a huge crest and still be quiet: whole-file RMS is dominated by silence, so check the trim gain and the audible level, not only crest.
- Windows can fail the `gen-log.json` write with `UNKNOWN: unknown error, open` (seen once, probably a virus scanner); the mp3 was already written, so the item only needs its log entry, not a redo.
- ACE-Step returns slightly less than the requested duration for stingers (15 s asked, 9.8 s heard) and about 1-3 s under for long tracks; ask for more than you need.
