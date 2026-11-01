<#
  贴图压缩：把模型里过大的贴图按最长边缩到 -Max，生成一份副本并切过去。

  为什么要做：Live2D 模型的贴图是整页图集，常见 4096×8192、8192×8192。
  解压后单张 8192² 就要 256MB 显存/内存，五张一起能把桌宠顶到 2GB。
  桌宠窗口通常只有 400~800px 高，2048 已经完全够用。

  用法（普通用户双击「贴图压缩.cmd」即可）：
    powershell -ExecutionPolicy Bypass -File tools\shrink-textures.ps1
    powershell ... -Max 1024        # 更省内存，细节更糊
    powershell ... -Model "D:\x\大肥鱼.model3.json"
    powershell ... -NoLaunch        # 只生成，不重启桌宠
#>
param(
  [int]$Max = 2048,
  [string]$Model = '',
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# 被桌宠主程序调用时（STAGE_UTF8=1）改输出 UTF-8，主进程按 UTF-8 记日志就不会乱码；
# 用户自己在 cmd 里双击时保持控制台默认（GBK），中文显示正常。
if ($env:STAGE_UTF8 -eq '1') { try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {} }

function Fail($msg) { Write-Host "[失败] $msg" -ForegroundColor Red; exit 1 }

# 1. 找到当前挂载的模型
if (-not $Model) {
  $home_ = if ($env:STAGE_HOME) { $env:STAGE_HOME } else { Join-Path $env:APPDATA 'live2d-stage' }
  $sf = Join-Path $home_ 'settings.json'
  if (-not (Test-Path $sf)) { Fail "没找到设置文件 $sf —— 先启动一次桌宠并选好模型" }
  $cfg = Get-Content $sf -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $cfg.model) { Fail '设置里没有模型路径 —— 先启动一次桌宠并选好模型' }
  $Model = $cfg.model
}
if (-not (Test-Path $Model)) { Fail "模型不存在：$Model" }
$Model = (Resolve-Path $Model).Path
$base = Split-Path $Model -Parent
$name = Split-Path $Model -Leaf
Write-Host "模型：$Model"

# 2. 目标目录
$outName = "_opt$Max"
$out = Join-Path $base $outName
if (Test-Path (Join-Path $out $name)) {
  Write-Host "旧副本存在，先删除 $out"
  Remove-Item $out -Recurse -Force
}

# 3. 整目录复制（保证 .moc3 / physics / 表情 / 动作都不缺），再就地替换大贴图
New-Item -ItemType Directory -Force -Path $out | Out-Null
Get-ChildItem $base -Force | Where-Object { $_.Name -ne $outName } | Copy-Item -Destination $out -Recurse -Force

$json = Get-Content (Join-Path $out $name) -Raw -Encoding UTF8 | ConvertFrom-Json
$textures = $json.FileReferences.Textures
if (-not $textures) { Fail '模型里没有 Textures 字段' }

$savedBefore = 0.0
$savedAfter = 0.0
$big = 0
foreach ($rel in $textures) {
  $p = Join-Path $out ($rel -replace '/', '\')
  if (-not (Test-Path $p)) { Write-Host "  跳过（不存在）：$rel" -ForegroundColor Yellow; continue }

  $img = [System.Drawing.Image]::FromFile($p)
  try {
    $w = $img.Width; $h = $img.Height
    $savedBefore += ($w * $h * 4) / 1MB
    if ([Math]::Max($w, $h) -le $Max) {
      $savedAfter += ($w * $h * 4) / 1MB
      Write-Host ("  {0,-22} {1}x{2} 保持" -f (Split-Path $rel -Leaf), $w, $h)
      continue
    }
    $scale = $Max / [double]([Math]::Max($w, $h))
    $nw = [int][Math]::Round($w * $scale); $nh = [int][Math]::Round($h * $scale)
    $bmp = New-Object System.Drawing.Bitmap($nw, $nh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $nw, $nh)))
    } finally { $g.Dispose() }
    $img.Dispose()
    $img = $null
    Remove-Item $p -Force
    $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $savedAfter += ($nw * $nh * 4) / 1MB
    $big++
    Write-Host ("  {0,-22} {1}x{2} → {3}x{4}" -f (Split-Path $rel -Leaf), $w, $h, $nw, $nh) -ForegroundColor Green
  } finally {
    if ($img) { $img.Dispose() }
  }
}

Write-Host ''
Write-Host ("贴图内存：{0:N0} MB → {1:N0} MB（缩小 {2} 张）" -f $savedBefore, $savedAfter, $big) -ForegroundColor Cyan

# 4. 切到副本（改设置里的 model 路径）
$optModel = Join-Path $out $name
$home_ = if ($env:STAGE_HOME) { $env:STAGE_HOME } else { Join-Path $env:APPDATA 'live2d-stage' }
$sf = Join-Path $home_ 'settings.json'
if (Test-Path $sf) {
  $cfg = Get-Content $sf -Raw -Encoding UTF8 | ConvertFrom-Json
  $cfg.model = $optModel
  $text = $cfg | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($sf, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "已切换设置 → $optModel" -ForegroundColor Cyan
} else {
  Write-Host "设置文件不存在，自己启动时选：$optModel" -ForegroundColor Yellow
}

# 5. 重启桌宠（先在任务管理器/托盘里关掉旧的，否则单实例锁会直接聚焦旧窗口）
if (-not $NoLaunch) {
  $exe = Join-Path (Split-Path $PSScriptRoot -Parent) '大肥鱼Live2d桌宠.exe'
  if (Test-Path $exe) {
    Write-Host '正在启动桌宠……'
    Start-Process -FilePath $exe
  }
}
Write-Host '完成。' -ForegroundColor Green
