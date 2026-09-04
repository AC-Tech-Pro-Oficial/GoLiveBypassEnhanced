@echo off
setlocal
title GoLiveBypassEnhanced Installer

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $b='enhanced/rtc-viewer-recovery-v1'; $u='https://api.github.com/repos/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/commits/'+[Uri]::EscapeDataString($b); $r=irm $u -Headers @{'User-Agent'='GoLiveBypassEnhanced-Installer'}; if([string]$r.sha -notmatch '^[0-9a-fA-F]{40}$'){throw 'GitHub nao devolveu um commit valido'}; $env:GOLIVE_ENHANCED_REF=[string]$r.sha; $s=irm ('https://raw.githubusercontent.com/AC-Tech-Pro-Oficial/GoLiveBypassEnhanced/'+$r.sha+'/installer/Install-Enhanced.ps1'); iex $s"
if errorlevel 1 (
  echo.
  echo   A instalacao falhou. Copie o erro acima e envie para diagnostico.
  echo.
  pause
  exit /b 1
)

exit /b 0
