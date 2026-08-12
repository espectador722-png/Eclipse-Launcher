@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "ECLIPSE_UNATTENDED=0"
if /I "%~1"=="/silent" set "ECLIPSE_UNATTENDED=1"
:: ================================================================
::  ESTE SCRIPT Y EL CODIGO QUE COMPILA PERTENECEN A SENPAI1940.
::  Prohibido copiar, redistribuir o ayudar a crackear el binario.
:: ================================================================
::  Eclipse Launcher - Compilar con Nuitka
::
::  A PROPOSITO mucho mas simple que COMPILAR_NUITKA.bat (el de
::  Eclipse Tools): este launcher no necesita ni blindaje fuerte ni
::  todas las libs de traduccion — es SOLO un bajador/instalador de
::  Eclipse Tools. Menos dependencias, menos peso, menos superficie
::  para que un antivirus heuristico dude (ver comentario grande en
::  launcher.py sobre por que existe este programa aparte).
:: ================================================================
echo ================================================================
echo   Eclipse Launcher - Build (Nuitka)
echo   Senpai1940 / Eclipse Zone
echo ================================================================
echo(

py -3.11 --version > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3.11 no encontrado. Instalalo desde python.org
    if not "%ECLIPSE_UNATTENDED%"=="1" pause
    exit /b 1
)
echo Interprete del build:
py -3.11 --version

echo Instalando dependencias (solo las minimas necesarias)...
py -3.11 -m pip install --user nuitka pywebview pythonnet clr_loader -q
if errorlevel 1 (
    echo [ERROR] Fallo pip install.
    if not "%ECLIPSE_UNATTENDED%"=="1" pause
    exit /b 1
)

if not exist "eclipse.ico" (
    if exist "..\EclipseTools\eclipse.ico" (
        copy /Y "..\EclipseTools\eclipse.ico" "eclipse.ico" > nul
    )
)

echo(
echo Compilando con Nuitka...
py -3.11 -m nuitka ^
  --standalone ^
  --assume-yes-for-downloads ^
  --enable-plugin=tk-inter ^
  --windows-console-mode=disable ^
  --windows-icon-from-ico=eclipse.ico ^
  --company-name="Eclipse Zone" ^
  --product-name="Eclipse Launcher" ^
  --file-version=1.0.0.0 ^
  --product-version=1.0.0.0 ^
  --output-dir=dist_launcher ^
  --include-data-dir=web=web ^
  --output-filename="Eclipse Launcher.exe" ^
  launcher.py

if errorlevel 1 (
    echo [ERROR] Fallo la compilacion con Nuitka.
    if not "%ECLIPSE_UNATTENDED%"=="1" pause
    exit /b 1
)

set "ECLIPSE_DIST_RAW=dist_launcher\launcher.dist"
set "ECLIPSE_DIST_FINAL=dist_launcher\Eclipse Launcher"
if exist "%ECLIPSE_DIST_FINAL%" rmdir /S /Q "%ECLIPSE_DIST_FINAL%"
ren "%ECLIPSE_DIST_RAW%" "Eclipse Launcher"

echo(
echo ================================================================
echo   [OK] Build lista:
echo     dist_launcher\Eclipse Launcher\Eclipse Launcher.exe
echo ================================================================
if not "%ECLIPSE_UNATTENDED%"=="1" pause
