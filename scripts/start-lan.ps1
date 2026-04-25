<#
.SYNOPSIS
  Start Beatsync in LAN mode — production build, no HMR, auto-detect IP.
.DESCRIPTION
  1. Builds the Next.js client (production)
  2. Starts both client (port 3000) and server (port 8080) via Turborepo
  3. Prints the LAN URL for other devices to connect
#>

$ErrorActionPreference = "Stop"

# --- Detect LAN IP ---
$lanIp = (
    Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.InterfaceAlias -notmatch "Loopback" -and
        $_.IPAddress -notmatch "^127\." -and
        $_.IPAddress -notmatch "^169\.254\." -and
        $_.PrefixOrigin -ne "WellKnown"
    } |
    Sort-Object -Property InterfaceMetric |
    Select-Object -First 1
).IPAddress

if (-not $lanIp) {
    Write-Host "[!] Could not detect LAN IP. Make sure you are connected to a network." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Beatsync LAN Mode" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Local:    http://localhost:3000" -ForegroundColor Green
Write-Host "  LAN:      http://${lanIp}:3000" -ForegroundColor Yellow
Write-Host "  Server:   http://${lanIp}:8080" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Other devices: open the LAN URL above" -ForegroundColor DarkGray
Write-Host "  No .env changes needed — IP is auto-detected" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Build client (production, no HMR) ---
Write-Host "[1/2] Building client..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot\.."
try {
    bun run --filter=client build
} finally {
    Pop-Location
}

# --- Start both services ---
Write-Host "[2/2] Starting server + client..." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Ready! Share this URL with other devices:" -ForegroundColor Green
Write-Host "  >>> http://${lanIp}:3000 <<<" -ForegroundColor Yellow
Write-Host ""

Push-Location "$PSScriptRoot\.."
try {
    bun run start
} finally {
    Pop-Location
}
