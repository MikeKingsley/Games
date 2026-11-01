# Builds the finished offline-capable site into ./dist (and ./Games-site.zip) ready to upload to any static HTTPS host
# (Netlify Drop, Cloudflare Pages, GitHub Pages, Azure Static Web Apps, ...). Hosted at a domain root, so no base-path changes.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $root 'publish'
$dist = Join-Path $root 'dist'

dotnet publish (Join-Path $root 'Games.Client') -c Release -o $tmp
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
Copy-Item (Join-Path $tmp 'wwwroot') $dist -Recurse

# Deep links such as /play/animal-feeding must serve index.html (single-page app fallback).
Set-Content (Join-Path $dist '_redirects') '/*    /index.html   200' -Encoding ascii    # Netlify, Cloudflare Pages
Copy-Item (Join-Path $dist 'index.html') (Join-Path $dist '404.html')                    # GitHub Pages
New-Item (Join-Path $dist '.nojekyll') -ItemType File -Force | Out-Null                  # GitHub Pages: serve _framework as-is

$zip = Join-Path $root 'Games-site.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zip -Force
Remove-Item $tmp -Recurse -Force

$mb = [math]::Round((Get-ChildItem $dist -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "Built $dist ($mb MB) and $zip"
