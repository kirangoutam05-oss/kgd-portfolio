<#
    import-images.ps1
    Takes a folder of images downloaded from Google Drive (whatever they are
    named) and copies them into outputs/assets/jumbofarms/ under the filenames
    the site expects, matching each one against IMAGE-MANIFEST.csv by product
    name. Nothing is moved or overwritten unless you pass -Force.

    Preview what it would do:
        powershell -ExecutionPolicy Bypass -File tools\import-images.ps1 -Source "$HOME\Downloads\drive-export" -WhatIf

    Do it:
        powershell -ExecutionPolicy Bypass -File tools\import-images.ps1 -Source "$HOME\Downloads\drive-export"
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string] $Source,

    [switch] $Force
)

$ErrorActionPreference = 'Stop'
$root     = Split-Path $PSScriptRoot -Parent
$outputs  = Join-Path $root 'outputs'
$target   = Join-Path $outputs 'assets\jumbofarms'
$manifest = Join-Path $target 'IMAGE-MANIFEST.csv'

if (-not (Test-Path $Source))   { throw "Source folder not found: $Source" }
if (-not (Test-Path $manifest)) { throw "Manifest not found: $manifest" }
if (-not (Test-Path $target))   { New-Item -ItemType Directory -Path $target | Out-Null }

function Normalize([string] $text) {
    ($text.ToLower() -replace '\.(jpg|jpeg|png|webp)$', '' -replace '[^a-z0-9]', '')
}

$rows = Import-Csv $manifest
$candidates = Get-ChildItem $Source -Recurse -File |
    Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' }

Write-Host ""
Write-Host ("Manifest rows: {0}    Images found in source: {1}" -f $rows.Count, $candidates.Count)
Write-Host ("-" * 72)

$matched = 0
$claimed = @{}

foreach ($row in $rows) {
    $destName = Split-Path $row.SaveAs -Leaf
    $dest     = Join-Path $target $destName

    if ((Test-Path $dest) -and -not $Force) {
        Write-Host ("  skip    {0}  (already present)" -f $destName) -ForegroundColor DarkGray
        $matched++
        continue
    }

    $wantProduct = Normalize $row.Product
    $wantSlug    = Normalize $destName

    # exact normalized match on the product title or the target filename first,
    # then fall back to the longest common-token overlap
    $hit = $candidates | Where-Object {
        $n = Normalize $_.Name
        ($n -eq $wantProduct) -or ($n -eq $wantSlug)
    } | Select-Object -First 1

    if (-not $hit) {
        $hit = $candidates |
            Where-Object { -not $claimed.ContainsKey($_.FullName) } |
            Sort-Object -Descending {
                $n = Normalize $_.Name
                if ($wantProduct.Length -ge 6 -and $n.Contains($wantProduct)) { 1000 + $n.Length }
                elseif ($n.Length -ge 6 -and $wantProduct.Contains($n))       { 900 + $n.Length }
                else { 0 }
            } | Select-Object -First 1

        $score = Normalize $hit.Name
        if (-not ($wantProduct.Contains($score) -or $score.Contains($wantProduct))) { $hit = $null }
    }

    if ($hit) {
        $claimed[$hit.FullName] = $true
        if ($PSCmdlet.ShouldProcess($destName, "copy from $($hit.Name)")) {
            Copy-Item $hit.FullName $dest -Force
        }
        Write-Host ("  ok      {0}  <-  {1}" -f $destName, $hit.Name) -ForegroundColor Green
        $matched++
    } else {
        Write-Host ("  MISSING {0}  ({1})" -f $destName, $row.Product) -ForegroundColor Yellow
    }
}

$unused = $candidates | Where-Object { -not $claimed.ContainsKey($_.FullName) }

Write-Host ""
Write-Host ("Matched {0} of {1}." -f $matched, $rows.Count)
if ($unused) {
    Write-Host "`nSource images nothing claimed (rename these to the target filename by hand):" -ForegroundColor DarkYellow
    $unused | ForEach-Object { Write-Host "  $($_.Name)" }
}
Write-Host "`nNow run:  powershell -ExecutionPolicy Bypass -File tools\check-assets.ps1`n"
