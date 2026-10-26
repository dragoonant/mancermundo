@echo off
rem M9 figures on this PC: 27 bodies then 28 attachments (Pathfinders, Hierotek Circle, Wyrmblade leaders). One GPU job at a time.
set REPO=%~dp0..\..
set W=%USERPROFILE%\Hunyuan3D-2\outputs\ms-work\m9
set PYTHONIOENCODING=utf-8
set BSLUGS=ht-apprentek ht-chronomancer ht-deathmark ht-immortal-despotek ht-immortal-guardian ht-plasmacyte-accelerator ht-plasmacyte-reanimator ht-psychomancer ht-technomancer pf-assault-grenadier pf-blooded pf-comms-specialist pf-drone-controller pf-marksman pf-mb3-recon-drone pf-medical-technician pf-mv1-gun-drone pf-mv31-pulse-accelerator-drone pf-mv33-grav-inhibitor-drone pf-mv4-shield-drone pf-mv7-marker-drone pf-shasla pf-shasui pf-transpectral-interference pf-weapons-expert wb-kelermorph wb-locus
set ASLUGS=ht-w-abyssal-lance ht-w-aeonstave ht-w-arcane-conduit ht-w-atomiser-beam ht-w-entropic-lance ht-w-gauss-blaster ht-w-spark ht-w-staff-of-light ht-w-synaptic-disintegrator ht-w-tesla-carbine pf-e-fusion-grenade pf-w-burst-cannon pf-w-ion-rifle pf-w-marksman-rail-rifle pf-w-pulse-carbine pf-w-rail-rifle pf-w-suppressed-pulse-carbine pf-w-twin-pulse-carbine wb-w-master-crafted-autopistol wb-w-mining-laser wb-w-power-maul wb-w-power-pick wb-w-sanctus-bio-dagger wb-w-sanctus-sniper-rifle wb-w-seismic-cannon wb-w-shotgun wb-w-web-pistol wb-w-webber
if not exist %W% mkdir %W%
if exist %W%\chain.done del %W%\chain.done
if exist %W%\attach-chain.done del %W%\attach-chain.done
echo start %date% %time% > %W%\chain.log
cd /d %USERPROFILE%\Hunyuan3D-2
set PICKS=m9_picks.json
.venv\Scripts\python.exe merge_units.py "%REPO%\tools\local-gen\ms_units.json" >> %W%\chain.log 2>&1
.venv\Scripts\python.exe stage_cutout.py %BSLUGS% > %W%\cutout.log 2>&1
echo cutout %date% %time% >> %W%\chain.log
cd /d %USERPROFILE%\Hunyuan3D-2.1
.venv\Scripts\python.exe stage_shape.py --only %BSLUGS% > %W%\shape.log 2>&1
echo shape %date% %time% >> %W%\chain.log
cd /d %USERPROFILE%\Hunyuan3D-2
.venv\Scripts\python.exe stage_paint.py --only %BSLUGS% > %W%\paint.log 2>&1
echo paint %date% %time% >> %W%\chain.log
..\Hunyuan3D-2.1\.venv\Scripts\python.exe stage_finalize.py "%REPO%\public\assets\models\bodies" %BSLUGS% > %W%\finalize.log 2>&1
echo done %date% %time% >> %W%\chain.log
echo done > %W%\chain.done
echo start %date% %time% > %W%\attach-chain.log
set PICKS=m9_attach_picks.json
cd /d %USERPROFILE%\Hunyuan3D-2
.venv\Scripts\python.exe stage_cutout.py %ASLUGS% > %W%\attach-cutout.log 2>&1
cd /d %USERPROFILE%\Hunyuan3D-2.1
.venv\Scripts\python.exe stage_shape.py --faces 4000 --nocut %ASLUGS% --only %ASLUGS% > %W%\attach-shape.log 2>&1
cd /d %USERPROFILE%\Hunyuan3D-2
.venv\Scripts\python.exe stage_paint.py --texture 512 --only %ASLUGS% > %W%\attach-paint.log 2>&1
echo done %date% %time% >> %W%\attach-chain.log
echo done > %W%\attach-chain.done
