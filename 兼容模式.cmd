@echo off
chcp 936 >nul
setlocal
set "HERE=%~dp0"
set "EXE="
for %%x in ("%~dp0*.exe") do set "EXE=%%~fx"
if not defined EXE (
  echo [错误] 没找到 exe，请把本文件和桌宠放在同一目录。
  pause
  exit /b 1
)
echo ============================================
echo  兼容模式启动
echo  关闭硬件加速 + 渲染沙箱：
echo  显卡/驱动不支持透明窗口、或杀软拦沙箱时用这个
echo ============================================
echo.
"%EXE%" --safe --no-sandbox --disable-gpu-sandbox