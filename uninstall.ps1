# uninstall.ps1 — undo install.ps1 on this Windows machine.
# Pass -DeleteGist to also delete the GitHub gist.

param([switch]$DeleteGist)

$InstallDir = Join-Path $env:USERPROFILE ".usage-watcher"
$ConfigDir  = Join-Path $env:USERPROFILE ".config\usage-watcher"
$EnvFile    = Join-Path $ConfigDir ".env"

Write-Host "▸ Unregistering Scheduled Tasks…"
Unregister-ScheduledTask -TaskName UsageWatcherDaemon -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName UsageWatcherTray   -Confirm:$false -ErrorAction SilentlyContinue

if ($DeleteGist -and (Test-Path $EnvFile)) {
    $line = Select-String -Path $EnvFile -Pattern "^GIST_ID=" | Select-Object -First 1
    if ($line) {
        $gistId = ($line.Line -replace "^GIST_ID=", "").Trim('"',' ')
        if ($gistId -and (Get-Command gh -ErrorAction SilentlyContinue)) {
            Write-Host "▸ Deleting gist $gistId…"
            & gh gist delete $gistId --yes 2>$null
        }
    }
}

Write-Host "▸ Removing files…"
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
if (Test-Path $ConfigDir)  { Remove-Item -Recurse -Force $ConfigDir }

# Also stop any running tray process
Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains("tray.ps1")
} | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "✓ Uninstalled. iPhone widget can be removed manually (long-press → remove)."
