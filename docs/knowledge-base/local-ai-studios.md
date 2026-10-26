# Local AI studios (the GPU PC's generation suite)

Project folder `C:\Claude Code Projects\3D Model Generation` (private repo github.com/dragoonant/local-ai-studio). Everything runs on this Windows PC (RTX 5080, 16 GB VRAM). A second PC, Alteisen (RTX 3080 10 GB, `ssh alteisen`, pipeline in `E:\AI`, launchers `py2.bat`/`py21.bat`), can run Hunyuan batches in parallel.

| Studio | Port | Models | API |
|---|---|---|---|
| Hunyuan Studio (`server.js` in the root) | 7860 | SDXL or Flux concepts -> Hunyuan3D 2.1 shape -> 2.0 paint | `POST /api/jobs`, `GET /api/jobs/<id>`, `GET /files/<id>/<file>` |
| Video Studio (`video-studio/`) | 7870 | HunyuanVideo 1.5 on ComfyUI | same shape |
| Flux Studio (`flux-studio/`) | 7880 | FLUX.2 klein (Apache-2.0, 4 steps, about 6 s per 832x1216), FLUX.1 dev/schnell | `POST /api/jobs {model:'klein'|'dev'|'schnell', prompt, aspect:'2:3'|'3:2'|..., megapixels:1, batch:1, seed}` -> `{id}`; `GET /api/jobs/<id>` -> `{status, images:[name]}`; `GET /files/<id>/<image>`; `POST /api/settings {freeAfter:false}` keeps the model loaded for a batch; also image edit mode |
| Audio Studio (`audio-studio/`, worktree branch `claude/ai-audio-generation-packages-2714d8`, uncommitted to main as of 2026-10-17) | 7890 | ACE-Step 1.5 turbo (music, Apache-2.0), Stable Audio Open 1.0 (SFX, Stability community licence), HunyuanVideo-Foley (non-commercial), Chatterbox (MIT, watermarked output), Qwen3-TTS 1.7B (Apache-2.0: Voice Clone, Voice Design, Preset Voices) | `POST /api/jobs` with `mode` music/sfx/foley/voice (params below); `GET /api/jobs`, `GET /api/jobs/<id>`, `POST /api/jobs/<id>/cancel`, `/force`, `DELETE`; `GET /files/<id>/<file>`; `GET /api/status`; `POST /api/backend/free` |

All four share one ComfyUI on port 8188 (`%USERPROFILE%\HunyuanVideo\ComfyUI_windows_portable`) and queue GPU work one job at a time. On 2026-10-17 all four studios plus ComfyUI were running.

## Audio Studio job parameters (from `server.js` `sanitize()`)
- **music:** `{mode:'music', prompt (style line), lyrics ('[Instrumental]' when empty), duration 10-240 s (default 60), steps 1-30 (default 8), guidance (1), shift (3), bpm 10-300 (120), key (ACE keys, 'C major'), timesig '2'|'3'|'4'|'6', language, batch 1-2, seed}` -> `audio_0.flac`. Measured: 30 s instrumental 11 s cold, 40 s song 8 s warm.
- **sfx:** `{mode:'sfx', prompt, negative, seconds 1-47 (default 10), steps 1-100 (default 50), guidance 0-15 (default 5), batch 1-4, seed}` -> `audio_0..n.flac`. Measured: two 6 s effects in 5 s.
- **foley:** `{mode:'foley', prompt, negative ('noisy, harsh'), duration 1-60, steps, guidance, seed, video (data URL)}` -> audio plus `video_with_audio.mp4`.
- **voice:** `{mode:'voice', model:'chatterbox'|'chatterbox-mtl'|'chatterbox-turbo'|'qwen-clone'|'qwen-design'|'qwen-custom', text (<= 6000 chars), language, refText, instruct (voice description for qwen-design, delivery note for qwen-custom), speaker (qwen-custom presets, e.g. 'Vivian'), exaggeration 0-2 (0.5), cfg 0-1 (0.5), temperature (0.8), seed, ref (data URL of a 5-10 s clip for clone models)}` -> `voice.wav`. Measured: 8-10 s per sentence plus 7-8 s model load.
- Job folder `audio-studio/outputs/<job-id>/` holds `job.json` (params, log, `audios`) and the files. Weights are already downloaded (`ace_step_1.5_turbo_aio.safetensors`, `stable_audio_open_1.0.safetensors`, `foley/hunyuanvideo_foley_fp8_e4m3fn.safetensors`; Qwen and Chatterbox English weights cached).
- Prompt lessons (ElevenLabs era, likely to transfer): describe the mechanism, not the brand; state exclusions ("no music, no voices"); measure crest factor (gunshots need >= 8); layer with `compose-audio.ts` when a single prompt can't get there.

## Hunyuan3D figure pipeline (outside the repo)
- `%USERPROFILE%\Hunyuan3D-2` (Python 3.11 venv: SDXL concepts, cutout, 2.0 paint, viewer on 8765) and `%USERPROFILE%\Hunyuan3D-2.1` (Python 3.10 venv with bpy: 2.1 shape, finalize). Weights as plain files under `%USERPROFILE%\.cache\hy3dgen`. Do not upgrade `transformers` 4.48.3 / `diffusers` 0.32.2 in the 2.0 venv. `UV_SYSTEM_CERTS=1`.
- Inputs: `units.json` `{slug: {prompt, height (inches), base (mm)}}` (251 entries on 2026-10-17) and `picks.json` `{slug: seed | absolute image path}`; write both without a UTF-8 BOM (PowerShell 5.1 `Out-File` adds one).
- Stages: (1) `concepts_sdxl.py` (6 SDXL candidates; `--style 0.2 --avoid "blue armour"` for non-Marine factions) or an external concept image (Gemini/Flux) -> (2) `stage_cutout.py` -> (3) `stage_shape.py --only <slugs> [--nocut <slug>]` (2.1 venv, about 90 s, auto-cuts the display base) -> (4) `stage_paint.py --only <slugs>` (about 20 s) -> (5) `stage_finalize.py <repo>\public\assets\models <slugs>` (scales to inches, black base, matte, preview PNGs and `final_contact_*.png` sheets). Whole 5-unit run about 12 min. One GPU job at a time.
- Hunyuan Studio UI wraps the same stages with quality presets (Fast 256/20, Standard 384/50, High 512/50), face count, texture 512/1024/2048, remove display base.
- Terrain: `terrain_*.py` scripts; painted Gemini concepts beat grey-resin SDXL (owner rejected the grey batches); `terrain_post.py --faces 9000`; decimate to about 6k tris for frame time; image-to-3D cannot do flat terrain (keep flats procedural).
- Weapon loadouts (Fell-in M5): figure concept edited into a stance with Flux klein image edit, Hunyuan 3D via the studios, weapon GLBs on measured hand sockets (`tools/local-gen/gen-poses.mjs`); true rigging rejected on fused Hunyuan meshes.
- Post-process in repos: `tools/models/optimize.mjs` (dedup, prune, weld, WebP <= 1024, meshopt); `GLTFLoader` then needs `setMeshoptDecoder` or every GLB silently falls back.
- Licence: Hunyuan3D under Tencent's non-commercial community licence.

## Concept image sources
- **Gemini via Claude in Chrome on this PC** (never the Mac, never the built-in browser): one chat per faction; base figure then edit variants ("start from image N, keep everything, change only X"); export via in-page JS (`?alr=yes` fetch for lh3 URLs, canvas for blob:) as one JSON bundle per tab; about 30 images per evening cap; reference images only through the hidden file input (never the clipboard, after a 2026-10-05 leak). Full recipe: Mallet `docs/HANDOFF-sd-figures-v2.md`.
- **Flux Studio (local, free):** text-to-image and image edit; no negative prompt (say "wordless and untitled, full-bleed"); a proper noun in a clause invites lettering; name the thing instead of "figure"/"creature"; review on labelled 4x4 contact sheets.
- **SDXL (local, free):** fallback; cannot hold an exact head ratio; 77-CLIP-token prompt limit (style first, generic tail last).

## MGSD figure standard (Mallet, approved 2026-10-05)
About 2-2.5 heads tall, head roughly 40% of total height and as wide as the shoulders, tiny torso, short stubby legs with big chunky feet, short arms with oversized hands and weapons, Master Grade hard-surface detail, plain round black base, white background, no text. Check the image, not the prompt. Reject duplicate/extra weapons, missing limbs, fused parts, garbled faces, text, cropped base, wrong wargear. (Whirr/WarMech/Dead of Winner/Fell-in instead used 3-5 head "stated in plain words" proportions; those projects ban the words MGSD/SD/chibi/Gundam.)

## Owner rules for GPU work
- Announce GPU work at the start of a session and wait for a go when the owner may be using the PC (Fell-in rule); on 2026-10-17 the owner waived the gate for Fell-in M5 and said "use those to develop the look and sound".
- Never run two GPU jobs at once; never `taskkill /F /IM node.exe` (it kills every studio).
- Concept approval for figures is delegated to Claude (Mallet, 2026-10-16); send contact sheets as FYI.
