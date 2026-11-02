@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_release.ps1" %*
if errorlevel 1 (
    echo.
    echo Echec de creation de l'archive.
    exit /b %errorlevel%
)
echo.
echo Archive prete dans le dossier dist.
endlocal