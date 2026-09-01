# Обеспечивает доступ к стенду TM-07 с других ПК в LAN (Hyper-V / Windows Firewall).
# Запуск: правый клик ? «Выполнить с помощью PowerShell» (лучше от администратора).
$ErrorActionPreference = 'Continue'

function Ensure-HyperVPort([string]$name, [int]$port) {
    if (-not (Get-Command New-NetFirewallHyperVRule -ErrorAction SilentlyContinue)) {
        return $false
    }
    $existing = Get-NetFirewallHyperVRule -DisplayName $name -ErrorAction SilentlyContinue
    if ($existing) {
        Set-NetFirewallHyperVRule -DisplayName $name -Enabled True -Action Allow -Direction Inbound -ErrorAction SilentlyContinue | Out-Null
        Write-Host "OK Hyper-V: $name"
        return $true
    }
    New-NetFirewallHyperVRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPorts $port -Enabled True -ErrorAction Stop | Out-Null
    Write-Host "CREATED Hyper-V: $name :$port"
    return $true
}

function Ensure-WindowsPort([string]$name, [int]$port) {
    $existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
    if ($existing) {
        Set-NetFirewallRule -DisplayName $name -Enabled True -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
        Write-Host "OK Firewall: $name"
        return
    }
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Any -ErrorAction Stop | Out-Null
    Write-Host "CREATED Firewall: $name :$port"
}

$lanIp = (
    Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
        $_.InterfaceAlias -notmatch 'Loopback|WSL|vEthernet|Hyper-V|Docker' -and
        ($_.InterfaceAlias -eq 'Ethernet' -or $_.InterfaceAlias -match '^(Wi-Fi|WLAN|Ethernet )')
    } |
    Select-Object -First 1 -ExpandProperty IPAddress
)
if (-not $lanIp) {
    $lanIp = (
        Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.InterfaceAlias -notmatch 'Loopback|WSL|vEthernet|Hyper-V|Docker' } |
        Select-Object -First 1 -ExpandProperty IPAddress
    )
}

Write-Host "LAN IP: $lanIp"
Write-Host "URL:    https://${lanIp}:8443"
Write-Host "CA:     https://${lanIp}:8443/bench-ca.crt"
Write-Host ""

try {
    [void](Ensure-HyperVPort 'TM07 Bench HTTPS 8443' 8443)
    [void](Ensure-HyperVPort 'TM07 Bench HTTP 8081' 8081)
} catch {
    Write-Host "Hyper-V firewall: $($_.Exception.Message)"
}

try {
    Ensure-WindowsPort 'TM07 Bench HTTPS 8443' 8443
    Ensure-WindowsPort 'TM07 Bench HTTP 8081' 8081
} catch {
    Write-Host "Windows Firewall (нужны права админа): $($_.Exception.Message)"
}

Write-Host ""
try {
    $r = & curl.exe -sk --connect-timeout 5 "https://${lanIp}:8443/api/bench-db-status.php?action=status"
    if ($r -match '"ok"\s*:\s*true') {
        Write-Host "CHECK OK: API отвечает на https://${lanIp}:8443"
    } else {
        Write-Host "CHECK WARN: ответ API неожиданный: $r"
    }
} catch {
    Write-Host "CHECK FAIL: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "На других ПК в сети откройте: https://${lanIp}:8443"
Write-Host "Проброс портов на публичный IP не нужен."
Write-Host "Wi-Fi: та же корпоративная сеть, что Ethernet стенда, либо USB Wi-Fi + мобильный хот-спот Windows."
Write-Host "Если браузер ругается на сертификат — один раз установите CA с /bench-ca.crt"
