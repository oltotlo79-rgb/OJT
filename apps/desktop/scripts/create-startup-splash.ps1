# NSIS portableの展開中に出す画像。外部フォント・画像・ネットワークは使用しない。
# 実行: powershell -NoProfile -File apps/desktop/scripts/create-startup-splash.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$outputPath = Join-Path $PSScriptRoot '..\build\startup.bmp'
$canvas = New-Object Drawing.Bitmap 560,250,([Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [Drawing.Graphics]::FromImage($canvas)
$resources = @()
try {
  $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#1b1e24'))
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $accent = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#6fd6bf'))
  $ink = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#f4f6fa'))
  $muted = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#b6c2d2'))
  $pen = New-Object Drawing.Pen $accent,3
  $titleFont = New-Object Drawing.Font 'Yu Gothic UI',25,([Drawing.FontStyle]::Bold),([Drawing.GraphicsUnit]::Pixel)
  $bodyFont = New-Object Drawing.Font 'Yu Gothic UI',18,([Drawing.FontStyle]::Regular),([Drawing.GraphicsUnit]::Pixel)
  $smallFont = New-Object Drawing.Font 'Yu Gothic UI',14,([Drawing.FontStyle]::Regular),([Drawing.GraphicsUnit]::Pixel)
  $format = New-Object Drawing.StringFormat
  $format.Alignment = [Drawing.StringAlignment]::Center
  $resources = @($accent,$ink,$muted,$pen,$titleFont,$bodyFont,$smallFont,$format)
  $graphics.DrawEllipse($pen,257,28,14,14)
  $graphics.DrawLines($pen,[Drawing.Point[]]@((New-Object Drawing.Point 264,42),(New-Object Drawing.Point 264,61),(New-Object Drawing.Point 296,61),(New-Object Drawing.Point 296,80)))
  $graphics.DrawEllipse($pen,289,80,14,14)
  $graphics.DrawString('電気教育ツール',$titleFont,$ink,(New-Object Drawing.RectangleF 24,109,512,38),$format)
  $graphics.DrawString('起動しています…',$bodyFont,$ink,(New-Object Drawing.RectangleF 24,163,512,28),$format)
  $graphics.DrawString('準備ができるまで、しばらくお待ちください。',$smallFont,$muted,(New-Object Drawing.RectangleF 24,201,512,25),$format)
  $canvas.Save($outputPath,[Drawing.Imaging.ImageFormat]::Bmp)
} finally {
  foreach($resource in $resources) { $resource.Dispose() }
  $graphics.Dispose()
  $canvas.Dispose()
}
Write-Output $outputPath
