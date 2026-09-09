$ErrorActionPreference = "Stop"
$src = "\\srv-fs\FileServer\Production\BD_Corrector\Инструкция по выпуску корректоров\Номера корректоров.xlsx"
$dstWin = "C:\Users\Public\nomera_korrektora.xlsx"
$mode = if ($args.Count -ge 1) { $args[0] } else { "pull" }

if (-not (Test-Path -LiteralPath $src)) {
  throw "Share file not found: $src"
}

if ($mode -eq "push") {
  if (-not (Test-Path -LiteralPath $dstWin)) {
    throw "Local temp not found: $dstWin (сначала положите файл через sync-serial-xlsx.sh)"
  }
  Copy-Item -LiteralPath $dstWin -Destination $src -Force
  Write-Output "OK push -> $src size=$((Get-Item $src).Length)"
} else {
  Copy-Item -LiteralPath $src -Destination $dstWin -Force
  Write-Output "OK pull <- $src"
  Write-Output "OK dest=$dstWin size=$((Get-Item $dstWin).Length) mtime=$((Get-Item $dstWin).LastWriteTime)"
}
