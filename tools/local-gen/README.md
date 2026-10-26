# Local generation batches (Hunyuan3D on this PC and Alteisen)

Bodies: `ms_units.json` (slug -> prompt, height in inches, base mm). Picks: `ms_picks.json` maps each slug to the
absolute path of its approved concept PNG in `art/unit-concepts/` (written by the M5 run; never commit the picks
file, it holds machine paths). Attachments (weapons/equipment) get their own `ms_attachments.json` later.

Per machine, one GPU job at a time (see docs/knowledge-base/local-ai-studios.md):
- This PC: `cd %USERPROFILE%\Hunyuan3D-2` then `stage_cutout.py`, `..\Hunyuan3D-2.1\.venv\Scripts\python.exe` for
  `stage_shape.py --only <slugs>`, `stage_paint.py --only <slugs>`, `stage_finalize.py <repo>\public\assets\models\bodies <slugs>`,
  with env `UNITS=<this folder>\ms_units.json PICKS=<this folder>\ms_picks.json` (or copy the two files over `units.json`/`picks.json`
  in a dedicated work dir).
- Alteisen: copy `ms_units.json`, `ms_picks.json` and the PNGs to `E:\AI\work\mancermundo\`, then `E:\AI\py2.bat` / `E:\AI\py21.bat`
  launchers (junctions do not resolve over SSH); pull the finished GLBs back with scp.
Split the 20 bodies roughly half and half; batches of at most 9 per machine. After finalize: `node tools/models/optimize.mjs`,
measure sockets, update `public/assets/models/manifest.json`, check `?gallery`.

## M9 batch (Pathfinders, Hierotek Circle, Plague Marines, Wyrmblade): 41 bodies + 42 attachments
`run_m9_local.bat` (27 bodies, 28 attachments, this PC) and `run_m9_alteisen.bat` (14 + 14, Alteisen, launch with `schtasks`) run the
same stages as day one; picks are `m9_picks.json` / `m9_attach_picks.json` in each machine's Hunyuan3D-2 folder (the `*.alteisen.json`
copies here hold the Alteisen paths; the local ones hold absolute concept paths and are not committed). New body sizes are appended to
`ms_units.json`; attachment finishing data (length, hold class, grip fraction) is in `tools/models/attachments.json`. Finalise bodies
with `stage_finalize.py` (the bat does it), then `measure-sockets.py`; attachments with `finalize-attachments.py` after copying
Alteisen's `outputs/<slug>/textured.glb` into `tools/models/raw/<slug>.glb`. QC: `node tools/models/shoot-figures.mjs`.
