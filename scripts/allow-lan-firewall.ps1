# Opens inbound TCP 5220 on Private networks so a phone on the same Wi-Fi can reach `scripts/run-lan.ps1`.
# Self-elevates (UAC prompt). Remove with: Remove-NetFirewallRule -DisplayName "Games dev (5220)"
$port = 5220
$name = "Games dev ($port)"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    return
}
if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private | Out-Null
}
Write-Host "Firewall rule '$name' is in place."
