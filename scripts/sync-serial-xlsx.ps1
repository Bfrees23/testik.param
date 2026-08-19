$ErrorActionPreference = "Stop"
$dstWin = "C:\Users\Public\nomera_korrektora.xlsx"
$base = "\\srv-fs\FileServer\Production\BD_Corrector"
if (-not (Test-Path -LiteralPath $base)) { throw "Share not found: $base" }
$dir = Get-ChildItem -LiteralPath $base -Directory | Where-Object { $_.Name -match "Инструкция|выпуску|корректор" } | Select-Object -First 1
if (-not $dir) {
  # fallback: any dir containing xlsx with "Номера"
  foreach ($d in Get-ChildItem -LiteralPath $base -Directory) {
    $hit = Get-ChildItem -LiteralPath $d.FullName -Filter "*.xlsx" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "Номера|номер" } | Select-Object -First 1
    if ($hit) { $src = $hit.FullName; break }
  }
} else {
  $src = Get-ChildItem -LiteralPath $dir.FullName -Filter "*.xlsx" |
    Where-Object { $_.Name -match "Номера|номер|корректор" } |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $src) { throw "xlsx not found under $base" }
Copy-Item -LiteralPath $src -Destination $dstWin -Force
Write-Output "OK source=$src"
Write-Output "OK dest=$dstWin size=$((Get-Item $dstWin).Length) mtime=$((Get-Item $dstWin).LastWriteTime)"
