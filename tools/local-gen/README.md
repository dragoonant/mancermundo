# Local generation batches (Hunyuan3D on this PC)

Bodies are the v2 dynamic-pose figures: one approved Gemini concept PNG per slug (`art/concepts/v2/`, listed in
`art/concepts/v2/figures.json`), weapons fused into the mesh. `v2_units.json` maps each slug to
`{prompt, height (inches), base (mm)}`.

Batch run, one team (house) at a time, one GPU job at a time (see docs/knowledge-base/local-ai-studios.md):

1. Write `%USERPROFILE%\Hunyuan3D-2\outputs\ms-work\v2\<team>.bodies.txt` (one line, space-separated slugs) and
   `%USERPROFILE%\Hunyuan3D-2\v2_<team>_picks.json` (slug -> absolute concept PNG path). Both hold machine paths and
   live outside the repo; never commit them. Write them without a UTF-8 BOM.
2. Make sure nothing else holds the GPU (local Audio Studio: `POST http://localhost:7890/api/backend/free`).
3. `cmd /c tools\local-gen\run_v2_local.bat <team>`: merges `v2_units.json` into the Hunyuan `units.json`, then cutout ->
   2.1 shape -> 2.0 paint -> finalize into `%USERPROFILE%\Hunyuan3D-2\outputs\ms-work\v2\bodies`. Stage logs are
   `<team>.cutout.log`, `.shape.log`, `.paint.log`, `.finalize.log` next to the bodies folder; `<team>.done` marks the end.
4. Copy the GLBs into `public/assets/models/bodies/`, run `node tools/models/optimize.mjs` if present, then
   `%USERPROFILE%\Hunyuan3D-2.1\.venv\Scripts\python.exe tools/models/measure-sockets.py` to write
   `public/assets/models/manifest.json` (`weaponsBaked`, pose `variants` from the `VARIANTS` table in that script).

The pose variants (`-b` slugs) are listed under their base slug in `VARIANTS` in `tools/models/measure-sockets.py`.
