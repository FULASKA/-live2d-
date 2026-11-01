@echo off
chcp 936 >nul
setlocal
set "HERE=%~dp0"
if not exist "%HERE%tools\shrink-textures.ps1" (
  echo [错误] 缺少 tools\shrink-textures.ps1，请重新解压完整压缩包。
  goto :end
)
echo ============================================
echo  贴图压缩：把模型大贴图缩到最长边 2048
echo  省内存（实测 592MB -^> 64MB），画质几乎无损
echo --------------------------------------------
echo  请先关掉桌宠窗口，结束后会自动重新打开。
echo  想缩得更小：本文件后面加 -- -Max 1024
echo ============================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HERE%tools\shrink-textures.ps1" %*
if errorlevel 1 echo.& echo [失败] 看上面的红字。
:end
if "%~1"=="" pause