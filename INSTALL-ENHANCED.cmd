@echo off
setlocal
title GoLiveBypassEnhanced Installer

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; irm 'https://raw.githubusercontent.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/enhanced/rtc-viewer-recovery-v1/installer/Install-Enhanced.ps1' | iex"
if errorlevel 1 (
  echo.
  echo   A instalacao falhou. Copie o erro acima e envie para diagnostico.
  echo.
  pause
  exit /b 1
)

exit /b 0
