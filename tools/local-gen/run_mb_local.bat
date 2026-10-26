@echo off
rem Batch B figures (Legionaries, Hand of the Archon, Hunter Clade, Hearthkyn) on this PC.
rem Usage: run_mb_local.bat <id>   Reads %W%\<id>.bodies.txt and %W%\<id>.att.txt (one line of space-separated slugs each).
rem Picks (slug -> concept PNG path) are mb_<id>_picks.json and mb_<id>_attach_picks.json in %USERPROFILE%\Hunyuan3D-2.
rem Bodies are finalised straight into the repo; raw attachment meshes stay in outputs\<slug>\textured.glb. One GPU job at a time.
set ID=%1
set REPO=%~dp0..\..
set W=%USERPROFILE%\Hunyuan3D-2\outputs\ms-work\mb
set PYTHONIOENCODING=utf-8
set BSLUGS=
set ASLUGS=
if not exist %W% mkdir %W%
if exist %W%\%ID%.bodies.txt set /p BSLUGS=<%W%\%ID%.bodies.txt
if exist %W%\%ID%.att.txt set /p ASLUGS=<%W%\%ID%.att.txt
if exist %W%\%ID%.done del %W%\%ID%.done
if exist %W%\%ID%.body.done del %W%\%ID%.body.done
echo start %date% %time% > %W%\%ID%.log
if "%BSLUGS%"=="" goto atts
cd /d %USERPROFILE%\Hunyuan3D-2
set PICKS=mb_%ID%_picks.json
.venv\Scripts\python.exe merge_units.py "%REPO%\tools\local-gen\ms_units.json" >> %W%\%ID%.log 2>&1
.venv\Scripts\python.exe stage_cutout.py %BSLUGS% > %W%\%ID%.cutout.log 2>&1
echo cutout %date% %time% >> %W%\%ID%.log
cd /d %USERPROFILE%\Hunyuan3D-2.1
.venv\Scripts\python.exe stage_shape.py --only %BSLUGS% > %W%\%ID%.shape.log 2>&1
echo shape %date% %time% >> %W%\%ID%.log
cd /d %USERPROFILE%\Hunyuan3D-2
.venv\Scripts\python.exe stage_paint.py --only %BSLUGS% > %W%\%ID%.paint.log 2>&1
echo paint %date% %time% >> %W%\%ID%.log
..\Hunyuan3D-2.1\.venv\Scripts\python.exe stage_finalize.py "%REPO%\public\assets\models\bodies" %BSLUGS% > %W%\%ID%.finalize.log 2>&1
echo bodies %date% %time% >> %W%\%ID%.log
:atts
echo done > %W%\%ID%.body.done
if "%ASLUGS%"=="" goto fin
set PICKS=mb_%ID%_attach_picks.json
cd /d %USERPROFILE%\Hunyuan3D-2
.venv\Scripts\python.exe stage_cutout.py %ASLUGS% > %W%\%ID%.attach-cutout.log 2>&1
cd /d %USERPROFILE%\Hunyuan3D-2.1
.venv\Scripts\python.exe stage_shape.py --faces 4000 --nocut %ASLUGS% --only %ASLUGS% > %W%\%ID%.attach-shape.log 2>&1
cd /d %USERPROFILE%\Hunyuan3D-2
.venv\Scripts\python.exe stage_paint.py --texture 512 --only %ASLUGS% > %W%\%ID%.attach-paint.log 2>&1
:fin
echo done %date% %time% >> %W%\%ID%.log
echo done > %W%\%ID%.done
