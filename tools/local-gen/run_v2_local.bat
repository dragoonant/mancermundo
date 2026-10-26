@echo off
rem v2 dynamic-pose bodies on this PC (weapons baked into the body). Usage: run_v2_local.bat <team>
rem Reads %W%\<team>.bodies.txt (one line of slugs) and %USERPROFILE%\Hunyuan3D-2\v2_<team>_picks.json (slug -> concept PNG).
rem Finalised GLBs land in %W%\bodies; copy them into the repo and run tools/models/measure-sockets.py. One GPU job at a time.
set REPO=%~dp0..\..
set ID=%1
set W=%USERPROFILE%\Hunyuan3D-2\outputs\ms-work\v2
set PYTHONIOENCODING=utf-8
set BSLUGS=
if not exist %W%\bodies mkdir %W%\bodies
set /p BSLUGS=<%W%\%ID%.bodies.txt
if exist %W%\%ID%.done del %W%\%ID%.done
echo start %date% %time% > %W%\%ID%.log
cd /d %USERPROFILE%\Hunyuan3D-2
set PICKS=v2_%ID%_picks.json
rem stale meshes from an earlier run would be re-painted if the shape stage fails: clear them first
for %%s in (%BSLUGS%) do (if exist outputs\%%s\shape.glb del outputs\%%s\shape.glb
  if exist outputs\%%s\textured.glb del outputs\%%s\textured.glb
  if exist outputs\%%s\final.glb del outputs\%%s\final.glb)
.venv\Scripts\python.exe merge_units.py "%REPO%\tools\local-gen\v2_units.json" >> %W%\%ID%.log 2>&1
.venv\Scripts\python.exe stage_cutout.py %BSLUGS% > %W%\%ID%.cutout.log 2>&1
echo cutout %date% %time% >> %W%\%ID%.log
cd /d %USERPROFILE%\Hunyuan3D-2.1
.venv\Scripts\python.exe stage_shape.py --only %BSLUGS% > %W%\%ID%.shape.log 2>&1
echo shape %date% %time% >> %W%\%ID%.log
cd /d %USERPROFILE%\Hunyuan3D-2
.venv\Scripts\python.exe stage_paint.py --only %BSLUGS% > %W%\%ID%.paint.log 2>&1
echo paint %date% %time% >> %W%\%ID%.log
..\Hunyuan3D-2.1\.venv\Scripts\python.exe stage_finalize.py "%W%\bodies" %BSLUGS% > %W%\%ID%.finalize.log 2>&1
echo done %date% %time% >> %W%\%ID%.log
echo done > %W%\%ID%.done
