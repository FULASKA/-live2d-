@echo off
chcp 936 >nul
setlocal
set "HERE=%~dp0"
set "OUT=%HERE%诊断报告.txt"
echo 正在收集信息（不联网、不上传）……
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HERE%tools\diagnose.ps1" > "%OUT%" 2>&1
echo.
echo 已生成：%OUT%
echo 把这个文件发给作者就能定位问题。
start "" notepad "%OUT%"
if "%~1"=="" pause