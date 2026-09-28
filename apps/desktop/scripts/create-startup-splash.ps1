# NSIS portableの展開中に出す画像。外部フォント・画像・ネットワークは使用しない。
# 実行: powershell -NoProfile -File apps/desktop/scripts/create-startup-splash.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$outputPath = Join-Path $PSScriptRoot '..\build\startup.bmp'
$canvas = New-Object Drawing.Bitmap 640,360,([Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [Drawing.Graphics]::FromImage($canvas)
$resources = @()
try {
  $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#09171f'))
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $accent = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#83ddca'))
  $ink = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#eef6f8'))
  $muted = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#b4c9d3'))
  $amber = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#e7ba79'))
  $surface = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#112934'))
  $grid = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(22,131,221,202)),1
  $border = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#2a4552')),1
  $base = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#385764')),2
  $pen = New-Object Drawing.Pen $accent,2
  $pen.StartCap = [Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
  $titleFont = New-Object Drawing.Font 'Yu Gothic UI',32,([Drawing.FontStyle]::Bold),([Drawing.GraphicsUnit]::Pixel)
  $bodyFont = New-Object Drawing.Font 'Yu Gothic UI',17,([Drawing.FontStyle]::Bold),([Drawing.GraphicsUnit]::Pixel)
  $smallFont = New-Object Drawing.Font 'Yu Gothic UI',14,([Drawing.FontStyle]::Regular),([Drawing.GraphicsUnit]::Pixel)
  $brandFont = New-Object Drawing.Font 'Segoe UI',11,([Drawing.FontStyle]::Bold),([Drawing.GraphicsUnit]::Pixel)
  $resources = @($accent,$ink,$muted,$amber,$surface,$grid,$border,$base,$pen,$titleFont,$bodyFont,$smallFont,$brandFont)

  $graphics.FillRectangle($surface,16,16,608,328)
  for ($x = 40; $x -lt 624; $x += 40) { $graphics.DrawLine($grid,$x,17,$x,343) }
  for ($y = 40; $y -lt 344; $y += 40) { $graphics.DrawLine($grid,17,$y,623,$y) }
  $graphics.DrawRectangle($border,16,16,608,328)
  $graphics.FillRectangle($accent,40,48,24,3)
  $graphics.DrawString('ELECTRICAL TRAINING',$brandFont,$accent,76,41)
  $graphics.DrawString('電気教育ツール',$titleFont,$ink,38,114)
  $graphics.DrawString('つないで、測って、動きを理解する。',$smallFont,$muted,40,170)

  # 端子、リレーコイル、接点を線だけで描く。
  $graphics.DrawRectangle($base,382,90,216,126)
  $graphics.DrawLine($base,382,153,426,153)
  $graphics.DrawLine($base,554,153,598,153)
  foreach ($line in @(
    @(382,90,434,90), @(434,90,434,153), @(434,153,468,153),
    @(512,153,546,153), @(546,153,546,90), @(546,90,598,90),
    @(480,153,500,153), @(382,216,456,216), @(456,216,484,198), @(500,216,598,216)
  )) { $graphics.DrawLine($pen,$line[0],$line[1],$line[2],$line[3]) }
  $graphics.DrawRectangle($pen,468,137,44,32)
  foreach ($point in @(@(382,90),@(598,90),@(382,216),@(598,216))) {
    $graphics.FillEllipse($surface,($point[0]-5),($point[1]-5),10,10)
    $graphics.DrawEllipse($pen,($point[0]-5),($point[1]-5),10,10)
  }
  $graphics.FillEllipse($accent,453,213,6,6)
  $graphics.FillEllipse($accent,497,213,6,6)
  $graphics.FillEllipse($accent,378,149,8,8)
  $graphics.FillEllipse($amber,594,149,8,8)

  $graphics.DrawLine($base,40,264,600,264)
  $graphics.DrawLine($pen,40,264,600,264)
  $graphics.FillEllipse($accent,40,288,7,7)
  $graphics.DrawString('起動しています…',$bodyFont,$ink,54,278)
  $graphics.DrawString('準備ができるまで、しばらくお待ちください。',$smallFont,$muted,54,310)
  $canvas.Save($outputPath,[Drawing.Imaging.ImageFormat]::Bmp)
} finally {
  foreach($resource in $resources) { $resource.Dispose() }
  $graphics.Dispose()
  $canvas.Dispose()
}
Write-Output $outputPath
