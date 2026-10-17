param([int]$TimeoutSeconds = 180)

# Hands build-web-motion.jsx to After Effects and waits for its log.
# AfterFX.exe -r passes the script to a running After Effects (or starts
# one) and returns at once, so the log file is the only way to hear back.
# After Effects only lets scripts write files with Edit > Preferences >
# Scripting & Expressions > "Allow Scripts to Write Files and Access
# Network" turned on; without it the project still builds but there is
# no log, no stills and no saved .aep.
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$script = Join-Path $PSScriptRoot "build-web-motion.jsx"
$out = Join-Path $repo "work\ae"
$log = Join-Path $out "build-log.json"

# The newest install wins, so 2026 is used over 2022 when both are there.
$ae = Get-ChildItem "C:\Program Files\Adobe" -Directory -Filter "Adobe After Effects *" -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName "Support Files\AfterFX.exe" } |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1
if (-not $ae) { throw "no After Effects install found under C:\Program Files\Adobe" }

New-Item -ItemType Directory -Force (Join-Path $out "frames") | Out-Null
if (Test-Path $log) { Remove-Item $log -Confirm:$false }

Write-Output "running $script in $ae"
& $ae -r $script

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not (Test-Path $log)) {
  if ((Get-Date) -gt $deadline) {
    throw "no log after $TimeoutSeconds s - check After Effects for a dialog, and that scripts may write files"
  }
  Start-Sleep -Milliseconds 500
}
Start-Sleep -Milliseconds 300   # let the write finish
$report = Get-Content $log -Raw -Encoding UTF8
Write-Output $report
if ($report -notmatch '"ok":true') { exit 1 }
