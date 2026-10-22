<#
.SYNOPSIS
    M365 Copilot2API Windows PowerShell Management Script
#>

param (
    [Parameter(Position=0)]
    [ValidateSet("start", "stop", "restart", "status", "logs", "set-password", "unlock")]
    [string]$Action = "status",

    [Parameter(Position=1)]
    [string]$Param1 = ""
)

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$BaseDir = $PSScriptRoot
$ExePath = Join-Path $BaseDir "copilot2api.exe"
$DataDir = Join-Path $BaseDir "data"
$PidFile = Join-Path $BaseDir "server.pid"
$LogFile = Join-Path $BaseDir "server.log"
$ErrFile = Join-Path $BaseDir "server-error.log"

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

function Get-ServerProcess {
    if (Test-Path $PidFile) {
        $savedPid = Get-Content $PidFile -ErrorAction SilentlyContinue | Out-String
        $savedPid = $savedPid.Trim()
        if ($savedPid -match '^\d+$') {
            $p = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
            if ($p -and $p.ProcessName -like "*m365*") {
                return $p
            }
        }
    }
    $procs = Get-Process -Name "copilot2api" -ErrorAction SilentlyContinue
    if ($procs) {
        return $procs[0]
    }
    return $null
}

function Start-Server {
    $existing = Get-ServerProcess
    if ($existing) {
        Write-Host "Server is already running (PID: $($existing.Id))" -ForegroundColor Yellow
        return
    }

    if (-not (Test-Path $ExePath)) {
        Write-Host "Executable not found at $ExePath. Compiling..." -ForegroundColor Cyan
        & go build -o $ExePath ./cmd/server
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Build failed!" -ForegroundColor Red
            return
        }
    }

    $env:M365_LISTEN = if ($env:M365_LISTEN) { $env:M365_LISTEN } else { "0.0.0.0:4141" }
    $env:M365_DATA_DIR = $DataDir
    $env:M365_CONFIG = Join-Path $DataDir "accounts.json"
    if (-not $env:M365_ADMIN_PASSWORD) {
        Remove-Item Env:\M365_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    }
    $env:M365_AUTO_CLEANUP = "1"
    $env:M365_AUTO_CLEANUP_KEEP_N = "50"

    Write-Host "Starting M365 Copilot2API..." -ForegroundColor Cyan
    $proc = Start-Process -FilePath $ExePath `
                          -WorkingDirectory $BaseDir `
                          -RedirectStandardOutput $LogFile `
                          -RedirectStandardError $ErrFile `
                          -PassThru

    $proc.Id | Out-File -FilePath $PidFile -Encoding ascii -Force
    Start-Sleep -Seconds 1

    $check = Get-ServerProcess
    if ($check) {
        Write-Host "Server started successfully! (PID: $($check.Id))" -ForegroundColor Green
        Write-Host "Dashboard URL : http://127.0.0.1:4141" -ForegroundColor Green
        Write-Host "Admin Password: $env:M365_ADMIN_PASSWORD (default)" -ForegroundColor Gray
    } else {
        Write-Host "Failed to start server. Check logs at: $ErrFile" -ForegroundColor Red
        if (Test-Path $ErrFile) {
            Get-Content $ErrFile -Tail 20
        }
    }
}

function Stop-Server {
    $proc = Get-ServerProcess
    if (-not $proc) {
        Write-Host "No running server detected." -ForegroundColor Yellow
        if (Test-Path $PidFile) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }
        return
    }

    Write-Host "Stopping server (PID: $($proc.Id))..." -ForegroundColor Cyan
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    if (Test-Path $PidFile) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }
    Write-Host "Server stopped." -ForegroundColor Green
}

function Show-Status {
    $proc = Get-ServerProcess
    if ($proc) {
        Write-Host "Server Status: RUNNING" -ForegroundColor Green
        Write-Host "  PID       : $($proc.Id)"
        Write-Host "  Memory    : $([math]::Round($proc.WorkingSet64 / 1MB, 2)) MB"
        Write-Host "  Dashboard : http://127.0.0.1:4141"
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:4141" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            Write-Host "  HTTP Probe: OK (HTTP $($resp.StatusCode))" -ForegroundColor Green
        } catch {
            Write-Host "  HTTP Probe: Port not responding" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Server Status: STOPPED" -ForegroundColor Yellow
    }
}

function Show-Logs {
    $n = 50
    if ($Param1 -match '^\d+$') { $n = [int]$Param1 }
    if (Test-Path $LogFile) {
        Write-Host "--- Tail $n lines from $LogFile ---" -ForegroundColor Cyan
        Get-Content $LogFile -Tail $n
    }
    if (Test-Path $ErrFile) {
        $errContent = Get-Content $ErrFile -Tail 10 -ErrorAction SilentlyContinue
        if ($errContent) {
            Write-Host "--- Recent Errors ($ErrFile) ---" -ForegroundColor Yellow
            $errContent
        }
    }
}

function Set-Password {
    $pwd = $Param1
    if (-not $pwd) {
        Write-Host "Error: Password is required." -ForegroundColor Red
        Write-Host "Usage: .\manage.ps1 set-password <YourNewStrongPassword>" -ForegroundColor Yellow
        Write-Host "Requirement: At least 12 characters, including 3 of 4 classes (upper, lower, digit, special)." -ForegroundColor Gray
        return
    }
    $env:M365_DATA_DIR = $DataDir
    & $ExePath -set-password $pwd
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Password updated! You can now log into http://127.0.0.1:4141 with your new password." -ForegroundColor Green
    }
}

switch ($Action) {
    "start"        { Start-Server }
    "stop"         { Stop-Server }
    "restart"      { Stop-Server; Start-Sleep -Seconds 1; Start-Server }
    "status"       { Show-Status }
    "logs"         { Show-Logs }
    "set-password" { Set-Password }
    "unlock"       { Stop-Server; Start-Sleep -Seconds 1; Start-Server; Write-Host "Login rate limit unlocked!" -ForegroundColor Green }
}
