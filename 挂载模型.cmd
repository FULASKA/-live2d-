@echo off
chcp 936 >nul
setlocal
set ELECTRON_RUN_AS_NODE=1
rem 用通配找 exe，避免在批处理里写中文字面量（GBK/UTF-8 混码会变乱码路径）
for %%x in ("%~dp0*.exe") do set "APP=%%~fx"
if not defined APP (
  echo [ERROR] 找不到 exe，请把本文件放在程序目录里再运行。
  pause
  exit /b 2
)
set "MODEL=%~1"
set "HOME_DIR=%~2"
if "%MODEL%"=="" set /p MODEL=把 xxx.model3.json 拖进来（或输入完整路径）后回车：
if "%MODEL%"=="" exit /b 2

if not "%HOME_DIR%"=="" (
  "%APP%" "%~dp0resources\app\tools\mount-model.mjs" "%MODEL%" --home "%HOME_DIR%"
  exit /b %ERRORLEVEL%
)

"%APP%" "%~dp0resources\app\tools\mount-model.mjs" "%MODEL%"
set "RC=%ERRORLEVEL%"
echo.
if "%~1"=="" pause
exit /b %RC%
