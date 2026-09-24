<#
    check-assets.ps1
    Reports which images the site references and which of those are on disk.
    Run from anywhere:  powershell -ExecutionPolicy Bypass -File tools\check-assets.ps1
#>

$ErrorActionPreference = 'Stop'
$outputs = Join-Path (Split-Path $PSScriptRoot -Parent) 'outputs'
$enc = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $outputs)) { throw "Cannot find $outputs" }

# Collect every image path the pages ask for, including the ones the
# galleries build at runtime from their data arrays.
$wanted = [ordered]@{}
foreach ($page in Get-ChildItem "$outputs\*.html") {
    $html = [IO.File]::ReadAllText($page.FullName, $enc)

    foreach ($m in [regex]::Matches($html, '(assets/[A-Za-z0-9/._-]+\.(?:jpg|jpeg|png|webp))')) {
        $wanted[$m.Groups[1].Value] = $page.Name
    }
    foreach ($m in [regex]::Matches($html, "\['[^']+','([a-z0-9-]+)'\]")) {
        $wanted["assets/jumbofarms/$($m.Groups[1].Value).jpg"] = $page.Name
    }
}

$present = @()
$missing = @()
foreach ($rel in $wanted.Keys) {
    $full = Join-Path $outputs ($rel -replace '/', '\')
    if (Test-Path $full -PathType Leaf) { $present += $rel } else { $missing += $rel }
}

Write-Host ""
Write-Host ("Referenced: {0}    Present: {1}    Missing: {2}" -f $wanted.Count, $present.Count, $missing.Count)
Write-Host ("-" * 62)

if ($missing.Count) {
    Write-Host "`nSTILL MISSING:" -ForegroundColor Yellow
    $missing | Sort-Object | ForEach-Object { Write-Host ("  {0}   (used by {1})" -f $_, $wanted[$_]) }
} else {
    Write-Host "`nEvery referenced image is present." -ForegroundColor Green
}

# Anything sitting in assets/ that no page asks for
$orphans = Get-ChildItem "$outputs\assets" -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' } |
    ForEach-Object { $_.FullName.Replace("$outputs\", '').Replace('\', '/') } |
    Where-Object { -not $wanted.Contains($_) }

if ($orphans) {
    Write-Host "`nIn assets/ but referenced by no page:" -ForegroundColor DarkYellow
    $orphans | ForEach-Object { Write-Host "  $_" }
}

Write-Host ""
if ($missing.Count) { exit 1 } else { exit 0 }
