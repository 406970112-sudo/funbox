param(
  [string]$OutputPath = "C:\Users\Administrator\Documents\funbox\docs\market-radar-product-design-v1.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$textPath = Join-Path (Split-Path $PSScriptRoot -Parent) "docs\market-radar-product-design-v1.text.json"
$T = Get-Content -LiteralPath $textPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Color([string]$hex) {
  return [System.Drawing.ColorTranslator]::FromHtml($hex)
}

function RoundPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Fill-Round([float]$x, [float]$y, [float]$w, [float]$h, [float]$r, [string]$hex) {
  $path = RoundPath $x $y $w $h $r
  $brush = New-Object System.Drawing.SolidBrush (Color $hex)
  $script:G.FillPath($brush, $path)
  $brush.Dispose()
  $path.Dispose()
}

function Stroke-Round([float]$x, [float]$y, [float]$w, [float]$h, [float]$r, [string]$hex, [float]$width = 1) {
  $path = RoundPath $x $y $w $h $r
  $pen = New-Object System.Drawing.Pen ((Color $hex), $width)
  $script:G.DrawPath($pen, $path)
  $pen.Dispose()
  $path.Dispose()
}

function Draw-Text(
  [string]$value,
  [float]$x,
  [float]$y,
  [float]$w,
  [float]$h,
  [float]$size,
  [string]$hex,
  [string]$style = "Regular",
  [string]$align = "Near",
  [string]$valign = "Center",
  [bool]$wrap = $false
) {
  $fontStyle = [System.Drawing.FontStyle]::$style
  $font = New-Object System.Drawing.Font ("Microsoft YaHei", $size, $fontStyle, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush (Color $hex)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::$align
  $format.LineAlignment = [System.Drawing.StringAlignment]::$valign
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
  if (-not $wrap) { $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap }
  $rect = New-Object System.Drawing.RectangleF ($x, $y, $w, $h)
  $script:G.DrawString($value, $font, $brush, $rect, $format)
  $format.Dispose()
  $brush.Dispose()
  $font.Dispose()
}

function Draw-Line([float]$x1, [float]$y1, [float]$x2, [float]$y2, [string]$hex, [float]$width = 1) {
  $pen = New-Object System.Drawing.Pen ((Color $hex), $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $script:G.DrawLine($pen, $x1, $y1, $x2, $y2)
  $pen.Dispose()
}

function Draw-Circle([float]$x, [float]$y, [float]$diameter, [string]$fill, [string]$stroke = "") {
  $brush = New-Object System.Drawing.SolidBrush (Color $fill)
  $script:G.FillEllipse($brush, $x, $y, $diameter, $diameter)
  $brush.Dispose()
  if ($stroke -ne "") {
    $pen = New-Object System.Drawing.Pen ((Color $stroke), 1)
    $script:G.DrawEllipse($pen, $x, $y, $diameter, $diameter)
    $pen.Dispose()
  }
}

function Draw-Spark([float]$x, [float]$y, [float]$w, [float]$h, [float[]]$values, [string]$hex) {
  $min = ($values | Measure-Object -Minimum).Minimum
  $max = ($values | Measure-Object -Maximum).Maximum
  $points = New-Object System.Collections.Generic.List[System.Drawing.PointF]
  for ($i = 0; $i -lt $values.Count; $i++) {
    $px = $x + ($w * $i / ($values.Count - 1))
    $ratio = if ($max -eq $min) { 0.5 } else { ($values[$i] - $min) / ($max - $min) }
    $py = $y + $h - ($ratio * $h)
    $points.Add([System.Drawing.PointF]::new($px, $py))
  }
  $pen = New-Object System.Drawing.Pen ((Color $hex), 2.4)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $script:G.DrawLines($pen, $points.ToArray())
  $pen.Dispose()
}

function Draw-ArrowUp([float]$x, [float]$y, [string]$hex) {
  $brush = New-Object System.Drawing.SolidBrush (Color $hex)
  $pts = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(($x + 6), $y),
    [System.Drawing.PointF]::new(($x + 12), ($y + 9)),
    [System.Drawing.PointF]::new($x, ($y + 9))
  )
  $script:G.FillPolygon($brush, $pts)
  $brush.Dispose()
}

function Draw-ArrowDown([float]$x, [float]$y, [string]$hex) {
  $brush = New-Object System.Drawing.SolidBrush (Color $hex)
  $pts = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($x, $y),
    [System.Drawing.PointF]::new(($x + 12), $y),
    [System.Drawing.PointF]::new(($x + 6), ($y + 9))
  )
  $script:G.FillPolygon($brush, $pts)
  $brush.Dispose()
}

function Draw-PhoneShell([float]$x, [float]$y, [float]$w, [float]$h) {
  Fill-Round $x $y $w $h 34 "#101426"
  Fill-Round ($x + 10) ($y + 10) ($w - 20) ($h - 20) 27 "#F8FAFF"
  Fill-Round ($x + ($w / 2) - 42) ($y + 17) 84 20 10 "#101426"
}

function Draw-Status([float]$x, [float]$y, [float]$w) {
  Draw-Text $T.time ($x + 28) ($y + 17) 65 24 12 "#171C36" "Bold"
  Draw-Line ($x + $w - 86) ($y + 26) ($x + $w - 78) ($y + 18) "#171C36" 2
  Draw-Line ($x + $w - 78) ($y + 18) ($x + $w - 70) ($y + 26) "#171C36" 2
  Stroke-Round ($x + $w - 60) ($y + 18) 26 13 4 "#171C36" 1.5
  Fill-Round ($x + $w - 57) ($y + 21) 18 7 2 "#171C36"
  Fill-Round ($x + $w - 32) ($y + 22) 3 5 1 "#171C36"
}

function Draw-BottomNav([float]$x, [float]$y, [float]$w) {
  $top = $y - 72
  $white = New-Object System.Drawing.SolidBrush (Color "#FFFFFF")
  $script:G.FillRectangle($white, $x, $top, $w, 72)
  $white.Dispose()
  Draw-Line $x $top ($x + $w) $top "#E6EAF4" 1
  $centers = @(($x + 50), ($x + 145), ($x + 240), ($x + 335))
  $labels = @($T.home, $T.tools, $T.message, $T.mine)
  for ($i = 0; $i -lt 4; $i++) {
    $active = ($i -eq 1)
    $c = if ($active) { "#4B6BFF" } else { "#9CA5BA" }
    Draw-Circle ($centers[$i] - 9) ($top + 12) 18 "#FFFFFF" $c
    if ($i -eq 1) {
      Draw-Line ($centers[$i] - 5) ($top + 21) ($centers[$i] + 5) ($top + 21) $c 2
      Draw-Line $centers[$i] ($top + 16) $centers[$i] ($top + 26) $c 2
    } elseif ($i -eq 0) {
      Draw-Line ($centers[$i] - 5) ($top + 21) $centers[$i] ($top + 16) $c 1.8
      Draw-Line $centers[$i] ($top + 16) ($centers[$i] + 5) ($top + 21) $c 1.8
    } elseif ($i -eq 2) {
      Fill-Round ($centers[$i] - 5) ($top + 17) 10 8 3 $c
    } else {
      Draw-Circle ($centers[$i] - 3) ($top + 16) 6 $c
      Draw-Line ($centers[$i] - 6) ($top + 26) ($centers[$i] + 6) ($top + 26) $c 2
    }
    Draw-Text $labels[$i] ($centers[$i] - 30) ($top + 35) 60 28 11 $c $(if ($active) { "Bold" } else { "Regular" }) "Center"
  }
}

function Draw-SectorRow([float]$x, [float]$y, [string]$name, [string]$change, [bool]$positive, [float[]]$points) {
  Draw-Text $name $x $y 118 48 15 "#171C36" "Bold"
  Draw-Spark ($x + 120) ($y + 13) 74 22 $points $(if ($positive) { "#4B6BFF" } else { "#33B66D" })
  if ($positive) { Draw-ArrowUp ($x + 218) ($y + 19) "#FF5D6C" } else { Draw-ArrowDown ($x + 218) ($y + 19) "#33B66D" }
  Draw-Text $change ($x + 236) $y 78 48 14 $(if ($positive) { "#FF5D6C" } else { "#33B66D" }) "Bold" "Far"
  Draw-Line $x ($y + 48) ($x + 314) ($y + 48) "#E8ECF5" 1
}

$bitmap = New-Object System.Drawing.Bitmap 1600, 1080
$G = [System.Drawing.Graphics]::FromImage($bitmap)
$G.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$G.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$G.Clear((Color "#EEF4FF"))

# Left strategy rail
Fill-Round 34 30 330 1020 22 "#FFFFFF"
Stroke-Round 34 30 330 1020 22 "#DDE5F4" 1
Fill-Round 60 58 42 42 10 "#151B3B"
Draw-Line 72 79 90 79 "#C9F36A" 4
Draw-Line 81 70 81 88 "#C9F36A" 4
Draw-Text $T.proposal 116 56 220 40 12 "#63708A" "Bold"
Draw-Text $T.title 60 114 250 50 30 "#151B3B" "Bold"
Draw-Text $T.subtitle 60 166 245 46 14 "#63708A" "Regular" "Near" "Near" $true

Draw-Text $T.problemTitle 60 232 245 28 14 "#171C36" "Bold"
$problemYs = @(270, 310, 350, 390)
$problemTexts = @($T.problem1, $T.problem2, $T.problem3, $T.problem4)
for ($i = 0; $i -lt 4; $i++) {
  Draw-Circle 61 ($problemYs[$i] + 8) 8 "#FF6B8F"
  Draw-Text $problemTexts[$i] 78 $problemYs[$i] 240 28 12 "#4D5870"
}

Draw-Text $T.decisionTitle 60 442 245 28 14 "#171C36" "Bold"
Fill-Round 60 480 278 58 8 "#F5F7FC"
Draw-Text $T.optionA 76 484 120 24 13 "#313A52" "Bold"
Draw-Text $T.optionADesc 76 508 238 20 11 "#7E879C"
Fill-Round 60 548 278 76 8 "#4B6BFF"
Fill-Round 274 558 50 22 11 "#C9F36A"
Draw-Text $T.recommend 274 557 50 22 10 "#151B3B" "Bold" "Center"
Draw-Text $T.optionB 76 554 180 27 14 "#FFFFFF" "Bold"
Draw-Text $T.optionBDesc 76 584 238 24 11 "#E7EBFF"
Fill-Round 60 634 278 58 8 "#F5F7FC"
Draw-Text $T.optionC 76 638 150 24 13 "#313A52" "Bold"
Draw-Text $T.optionCDesc 76 662 238 20 11 "#7E879C"

Draw-Text $T.scopeTitle 60 716 245 26 14 "#171C36" "Bold"
$scopeYs = @(752, 782, 812, 842)
$scopeTexts = @($T.scope1, $T.scope2, $T.scope3, $T.scope4)
for ($i = 0; $i -lt 4; $i++) {
  Draw-Text $scopeTexts[$i] 60 $scopeYs[$i] 270 25 11 "#4D5870"
}

Draw-Text $T.successTitle 60 892 245 26 14 "#171C36" "Bold"
$successYs = @(926, 952, 978)
$successTexts = @($T.success1, $T.success2, $T.success3)
for ($i = 0; $i -lt 3; $i++) {
  Draw-Circle 61 ($successYs[$i] + 8) 7 "#C9F36A"
  Draw-Text $successTexts[$i] 76 $successYs[$i] 250 22 10.5 "#4D5870"
}
Fill-Round 60 1012 278 24 6 "#EFF2FF"
Draw-Text $T.entry 68 1012 262 24 10 "#4B6BFF" "Bold" "Center"

# Screen labels
Fill-Round 405 28 162 30 15 "#151B3B"
Draw-Text $T.screen1 405 28 162 30 12 "#FFFFFF" "Bold" "Center"
Fill-Round 925 28 162 30 15 "#151B3B"
Draw-Text $T.screen2 925 28 162 30 12 "#FFFFFF" "Bold" "Center"

# Phone 1
$p1x = 395; $p1y = 68; $pw = 430; $ph = 970
Draw-PhoneShell $p1x $p1y $pw $ph
$s1x = $p1x + 10; $s1y = $p1y + 10; $sw = $pw - 20; $sh = $ph - 20
Draw-Status $s1x $s1y $sw
Draw-Text $T.title ($s1x + 24) ($s1y + 48) 190 48 24 "#151B3B" "Bold"
Draw-Text $T.updated ($s1x + 247) ($s1y + 52) 120 34 11 "#78839A" "Regular" "Far"

Fill-Round ($s1x + 18) ($s1y + 96) ($sw - 36) 158 16 "#151B3B"
Draw-Text $T.todayPulse ($s1x + 38) ($s1y + 112) 120 24 12 "#AEB8D5" "Bold"
Draw-Text "68" ($s1x + 34) ($s1y + 136) 95 66 48 "#FFFFFF" "Bold"
Fill-Round ($s1x + 134) ($s1y + 154) 58 26 13 "#C9F36A"
Draw-Text $T.strong ($s1x + 134) ($s1y + 154) 58 26 11 "#151B3B" "Bold" "Center"
Draw-Text $T.strongest ($s1x + 238) ($s1y + 116) 100 22 11 "#AEB8D5" "Bold" "Far"
Draw-Text $T.aiCompute ($s1x + 215) ($s1y + 140) 124 32 20 "#FFFFFF" "Bold" "Far"
Draw-ArrowUp ($s1x + 346) ($s1y + 151) "#FF7D8A"
Draw-Text "+3.39%" ($s1x + 270) ($s1y + 176) 72 24 13 "#FF7D8A" "Bold" "Far"
Draw-Line ($s1x + 38) ($s1y + 215) ($s1x + 338) ($s1y + 215) "#30395F" 7
Draw-Line ($s1x + 38) ($s1y + 215) ($s1x + 252) ($s1y + 215) "#C9F36A" 7
Draw-Text $T.up ($s1x + 38) ($s1y + 222) 80 22 11 "#D9DEF0" "Bold"
Draw-Text $T.down ($s1x + 260) ($s1y + 222) 80 22 11 "#D9DEF0" "Bold" "Far"

# Category and period segmented controls
Fill-Round ($s1x + 18) ($s1y + 270) ($sw - 36) 44 9 "#EEF1F8"
Fill-Round ($s1x + 22) ($s1y + 274) 108 36 7 "#FFFFFF"
Draw-Text $T.global ($s1x + 22) ($s1y + 274) 108 36 12 "#151B3B" "Bold" "Center"
Draw-Text $T.ai ($s1x + 140) ($s1y + 274) 108 36 12 "#7B859A" "Bold" "Center"
Draw-Text $T.metals ($s1x + 258) ($s1y + 274) 108 36 12 "#7B859A" "Bold" "Center"
Draw-Text $T.sectorStrength ($s1x + 22) ($s1y + 330) 150 30 17 "#171C36" "Bold"
Draw-Text $T.sortHint ($s1x + 250) ($s1y + 333) 116 24 10 "#8A93A7" "Regular" "Far"
Fill-Round ($s1x + 22) ($s1y + 366) 168 32 8 "#EEF1F8"
Fill-Round ($s1x + 25) ($s1y + 369) 52 26 6 "#FFFFFF"
Draw-Text $T.day1 ($s1x + 25) ($s1y + 369) 52 26 10 "#4B6BFF" "Bold" "Center"
Draw-Text $T.day5 ($s1x + 80) ($s1y + 369) 52 26 10 "#7B859A" "Bold" "Center"
Draw-Text $T.day20 ($s1x + 135) ($s1y + 369) 52 26 10 "#7B859A" "Bold" "Center"

$rowX = $s1x + 28
Draw-SectorRow $rowX ($s1y + 410) $T.aiCompute "+3.39%" $true ([float[]]@(2,4,3,6,7,10,12))
Draw-SectorRow $rowX ($s1y + 458) $T.cpo "+6.08%" $true ([float[]]@(2,3,5,4,7,9,14))
Draw-SectorRow $rowX ($s1y + 506) $T.semiconductor "+3.80%" $true ([float[]]@(3,5,4,6,6,8,10))
Draw-SectorRow $rowX ($s1y + 554) $T.gold "+4.36%" $true ([float[]]@(2,5,4,7,8,7,11))
Draw-SectorRow $rowX ($s1y + 602) $T.biomed "-1.49%" $false ([float[]]@(10,9,8,9,7,6,5))

Draw-Text $T.signals ($s1x + 22) ($s1y + 669) 130 30 17 "#171C36" "Bold"
Fill-Round ($s1x + 18) ($s1y + 706) ($sw - 36) 66 10 "#FFF1F4"
Draw-Circle ($s1x + 34) ($s1y + 724) 28 "#FF6B8F"
Draw-Text "!" ($s1x + 34) ($s1y + 723) 28 28 15 "#FFFFFF" "Bold" "Center"
Draw-Text $T.signalText ($s1x + 72) ($s1y + 716) 278 42 12 "#4A3140" "Bold" "Near" "Center" $true
Draw-Text $T.sourceLine ($s1x + 22) ($s1y + 782) 360 30 9.5 "#8992A6"
Draw-BottomNav $s1x ($s1y + $sh) $sw

# Phone 2
$p2x = 915; $p2y = 68
Draw-PhoneShell $p2x $p2y $pw $ph
$s2x = $p2x + 10; $s2y = $p2y + 10
Draw-Status $s2x $s2y $sw
Draw-Line ($s2x + 29) ($s2y + 70) ($s2x + 39) ($s2y + 60) "#171C36" 2.5
Draw-Line ($s2x + 29) ($s2y + 70) ($s2x + 39) ($s2y + 80) "#171C36" 2.5
Draw-Text $T.aiCompute ($s2x + 58) ($s2y + 49) 170 44 22 "#151B3B" "Bold"
Fill-Round ($s2x + 312) ($s2y + 57) 66 30 15 "#EEF1FF"
Draw-Text $T.watch ($s2x + 312) ($s2y + 57) 66 30 10 "#4B6BFF" "Bold" "Center"

Draw-Text "+3.39%" ($s2x + 24) ($s2y + 108) 150 52 34 "#FF5D6C" "Bold"
Draw-Text $T.trendTitle ($s2x + 252) ($s2y + 119) 126 26 11 "#7B859A" "Bold" "Far"

# Trend chart
$chartX = $s2x + 24; $chartY = $s2y + 169; $chartW = 354; $chartH = 126
Draw-Line $chartX ($chartY + $chartH) ($chartX + $chartW) ($chartY + $chartH) "#DDE3EF" 1
Draw-Line $chartX ($chartY + 82) ($chartX + $chartW) ($chartY + 82) "#E9EDF5" 1
Draw-Line $chartX ($chartY + 40) ($chartX + $chartW) ($chartY + 40) "#E9EDF5" 1
Draw-Spark ($chartX + 5) ($chartY + 8) ($chartW - 10) ($chartH - 18) ([float[]]@(8,13,11,17,16,24,22,31,29,41,47,44,56)) "#4B6BFF"
Draw-Circle ($chartX + $chartW - 10) ($chartY + 8) 10 "#4B6BFF"
Draw-Text "06/12" $chartX ($chartY + 130) 60 20 9 "#9AA3B7"
Draw-Text "07/10" ($chartX + 294) ($chartY + 130) 60 20 9 "#9AA3B7" "Regular" "Far"

Draw-Text $T.why ($s2x + 24) ($s2y + 332) 170 32 17 "#171C36" "Bold"
$reasonYs = @(($s2y + 374), ($s2y + 428), ($s2y + 482))
$reasonTitles = @($T.reason1Title, $T.reason2Title, $T.reason3Title)
$reasons = @($T.reason1, $T.reason2, $T.reason3)
for ($i = 0; $i -lt 3; $i++) {
  Fill-Round ($s2x + 24) $reasonYs[$i] 52 26 6 $(if ($i -eq 0) { "#EAF0FF" } elseif ($i -eq 1) { "#EEFAE6" } else { "#FFF1F4" })
  Draw-Text $reasonTitles[$i] ($s2x + 24) $reasonYs[$i] 52 26 10 $(if ($i -eq 0) { "#4B6BFF" } elseif ($i -eq 1) { "#3E8B38" } else { "#D84D71" }) "Bold" "Center"
  Draw-Text $reasons[$i] ($s2x + 88) ($reasonYs[$i] - 3) 286 32 11.5 "#3E475D" "Bold"
}

Draw-Text $T.symbols ($s2x + 24) ($s2y + 542) 220 32 17 "#171C36" "Bold"
Draw-Text $T.symbol ($s2x + 24) ($s2y + 579) 118 24 10 "#8A93A7" "Bold"
Draw-Text $T.weight ($s2x + 224) ($s2y + 579) 70 24 10 "#8A93A7" "Bold" "Far"
Draw-Text $T.change ($s2x + 312) ($s2y + 579) 66 24 10 "#8A93A7" "Bold" "Far"
$symbolYs = @(($s2y + 608), ($s2y + 650), ($s2y + 692))
$symbolNames = @($T.nvidia, $T.tsmc, $T.broadcom)
$weights = @("23%", "18%", "14%")
$changes = @("+4.8%", "+2.1%", "+3.6%")
for ($i = 0; $i -lt 3; $i++) {
  Draw-Text $symbolNames[$i] ($s2x + 24) $symbolYs[$i] 130 32 12.5 "#273047" "Bold"
  Draw-Text $weights[$i] ($s2x + 224) $symbolYs[$i] 70 32 12 "#576177" "Bold" "Far"
  Draw-Text $changes[$i] ($s2x + 306) $symbolYs[$i] 72 32 12 "#FF5D6C" "Bold" "Far"
  Draw-Line ($s2x + 24) ($symbolYs[$i] + 34) ($s2x + 378) ($symbolYs[$i] + 34) "#E8ECF5" 1
}

Draw-Text $T.method ($s2x + 24) ($s2y + 748) 120 24 13 "#171C36" "Bold"
Draw-Text $T.methodText ($s2x + 24) ($s2y + 776) 350 28 10.5 "#7A8498"
Fill-Round ($s2x + 24) ($s2y + 820) 354 48 10 "#4B6BFF"
Draw-Text $T.watch ($s2x + 24) ($s2y + 820) 354 48 14 "#FFFFFF" "Bold" "Center"
Draw-Text $T.disclaimer ($s2x + 24) ($s2y + 870) 354 24 9 "#9AA3B7" "Regular" "Center"
Draw-BottomNav $s2x ($s2y + $sh) $sw

# Right-side flow annotations
Draw-Line 1380 266 1422 266 "#4B6BFF" 2
Draw-Circle 1420 256 20 "#4B6BFF"
Draw-Text "1" 1420 256 20 20 10 "#FFFFFF" "Bold" "Center"
Draw-Text $T.annotation1 1450 249 110 32 13 "#151B3B" "Bold"
Draw-Text $T.annotation2 1450 491 110 32 13 "#151B3B" "Bold"
Draw-Line 1380 508 1422 508 "#FF6B8F" 2
Draw-Circle 1420 498 20 "#FF6B8F"
Draw-Text "2" 1420 498 20 20 10 "#FFFFFF" "Bold" "Center"
Draw-Line 1380 795 1422 795 "#65A63C" 2
Draw-Circle 1420 785 20 "#65A63C"
Draw-Text "3" 1420 785 20 20 10 "#FFFFFF" "Bold" "Center"
Draw-Text $T.annotation3 1450 778 110 32 13 "#151B3B" "Bold"

$outputDir = Split-Path $OutputPath -Parent
if (-not (Test-Path -LiteralPath $outputDir)) { New-Item -ItemType Directory -Path $outputDir | Out-Null }
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$G.Dispose()
$bitmap.Dispose()
Write-Output $OutputPath
