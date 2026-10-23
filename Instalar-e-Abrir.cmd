@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\Install-Orbital.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar. Veja a mensagem acima e .orbis\logs.
  pause
  exit /b 1
)
