# Serves the app on all network interfaces (port 5220) and prints the URLs to open on a phone on the same Wi-Fi.
$port = 5220
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -match '^(192\.168|10\.(?!5\.|100\.))|^172\.(1[6-9]|2\d|3[01])\.' -and $_.InterfaceAlias -notmatch 'vEthernet|VPN|Nord|Tailscale' } |
    ForEach-Object { Write-Host "Open on your phone:  http://$($_.IPAddress):$port/   ($($_.InterfaceAlias))" }
dotnet run --project (Join-Path $PSScriptRoot '..\Games.Client') --urls "http://0.0.0.0:$port" --no-launch-profile
