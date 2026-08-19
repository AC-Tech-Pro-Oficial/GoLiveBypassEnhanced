@echo off
setlocal
title GoLiveBypass standalone

rem O PowerShell recusa script baixado da internet por padrao. O -ExecutionPolicy Bypass vale
rem so para este processo: nao mexe na politica da maquina.

set "GLB_SCRIPT=%~dp0GoLiveBypass-Standalone.ps1"

if not exist "%GLB_SCRIPT%" (
    echo.
    echo   Nao achei o GoLiveBypass-Standalone.ps1 nesta pasta.
    echo   Baixe a pasta standalone inteira: o .ps1 e o golivebypass.js precisam estar juntos.
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0golivebypass.js" (
    echo.
    echo   Nao achei o golivebypass.js nesta pasta.
    echo   Ele e o bypass em si; sem ele o instalador nao tem o que instalar.
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%GLB_SCRIPT%" %*

echo.
pause
