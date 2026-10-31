@echo off
chcp 65001 >nul
setlocal
set ELECTRON_RUN_AS_NODE=1
set "MODEL=%~1"
set "HOME_DIR=%~2"

if "%MODEL%"=="" set /p MODEL=把 大肥鱼.model3.json 拖进来（或输入完整路径）后回车：

if not "%HOME_DIR%"=="" (
  "%~dp0大肥鱼Live2d桌宠.exe" "%~dp0resources\app\tools\mount-model.mjs" "%MODEL%" --home "%HOME_DIR%"
  exit /b %ERRORLEVEL%
)

"%~dp0大肥鱼Live2d桌宠.exe" "%~dp0resources\app\tools\mount-model.mjs" "%MODEL%"
set "RC=%ERRORLEVEL%"
echo.
if "%~1"=="" pause
exit /b %RC%
