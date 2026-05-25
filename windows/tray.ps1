# tray.ps1 — Windows system tray icon for usage-watcher
#
# Runs as a hidden Windows.Forms.NotifyIcon. Polls the local usage.json every
# 5 seconds, updates the tray tooltip + color dot, and exposes a right-click menu.
#
# Launched at logon by install.ps1 via Task Scheduler.

# Hide the console window (the script is launched with -WindowStyle Hidden, but
# in case it inherits a visible console, also stop showing it).
Add-Type -Name Window -Namespace Console -MemberDefinition @'
[DllImport("Kernel32.dll")]
public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, Int32 nCmdShow);
'@
$consolePtr = [Console.Window]::GetConsoleWindow()
[Console.Window]::ShowWindow($consolePtr, 0) | Out-Null

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$snapshotPath = Join-Path $env:USERPROFILE ".config\usage-watcher\usage.json"
$logPath      = Join-Path $env:USERPROFILE ".config\usage-watcher\daemon.out.log"
$envFile      = Join-Path $env:USERPROFILE ".config\usage-watcher\.env"

# --- Build an icon with a colored dot for the current status ---------------
function New-StatusIcon([string]$status) {
    # status = "green" | "yellow" | "red" | "gray"
    $bmp = New-Object System.Drawing.Bitmap(16, 16)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"

    # Background: a simple "C" letter for "Codex"
    $g.Clear([System.Drawing.Color]::Transparent)
    $fontBrush = [System.Drawing.Brushes]::White
    $f = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $g.FillEllipse([System.Drawing.Brushes]::DimGray, 0, 0, 16, 16)
    $g.DrawString("C", $f, $fontBrush, 1, 0)

    # Status dot in bottom-right
    $dotColor = switch ($status) {
        "green"  { [System.Drawing.Color]::LimeGreen }
        "yellow" { [System.Drawing.Color]::Gold }
        "red"    { [System.Drawing.Color]::Tomato }
        default  { [System.Drawing.Color]::Gray }
    }
    $brush = New-Object System.Drawing.SolidBrush $dotColor
    $g.FillEllipse($brush, 9, 9, 7, 7)
    $g.DrawEllipse([System.Drawing.Pens]::Black, 9, 9, 7, 7)
    $g.Dispose()

    $hIcon = $bmp.GetHicon()
    $icon  = [System.Drawing.Icon]::FromHandle($hIcon)
    return $icon
}

function Get-StatusFromPercent($p) {
    if ($p -eq $null) { return "gray" }
    if ($p -ge 85) { return "red" }
    if ($p -ge 60) { return "yellow" }
    return "green"
}

function Format-Countdown([long]$unixSec) {
    if (-not $unixSec) { return "—" }
    $now  = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $diff = $unixSec - $now
    if ($diff -le 0) { return "reset" }
    if ($diff -ge 86400) { return "{0}d {1}h" -f [int]($diff / 86400), [int](($diff % 86400) / 3600) }
    if ($diff -ge 3600)  { return "{0}h {1}m" -f [int]($diff / 3600),  [int](($diff % 3600)  / 60) }
    return "{0}m" -f [int]($diff / 60)
}

function Read-Snapshot {
    if (-not (Test-Path $snapshotPath)) { return $null }
    try {
        $raw = Get-Content $snapshotPath -Raw -ErrorAction Stop
        return $raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

# --- Build the tray icon + context menu -----------------------------------
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = New-StatusIcon "gray"
$notify.Text = "UsageWatcher — initialising…"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemTitle = $menu.Items.Add("Codex / Claude Usage")
$itemTitle.Enabled = $false
$menu.Items.Add("-") | Out-Null

$itemPrimary  = $menu.Items.Add("5h:  —")
$itemPrimary.Enabled = $false
$itemSecondary = $menu.Items.Add("Wk:  —")
$itemSecondary.Enabled = $false
$itemClaude = $menu.Items.Add("Claude today: —")
$itemClaude.Enabled = $false
$itemUpdated = $menu.Items.Add("Updated: —")
$itemUpdated.Enabled = $false

$menu.Items.Add("-") | Out-Null

$itemRefresh = $menu.Items.Add("Refresh now")
$itemRefresh.Add_Click({
    # Force the daemon to snapshot immediately via a one-shot run
    $repo = Join-Path $env:USERPROFILE ".usage-watcher"
    if (Test-Path "$repo\src\index.js") {
        Start-Process -FilePath "node" -ArgumentList "$repo\src\index.js","--once" -WindowStyle Hidden -Wait
        Update-Tray
    }
})

$itemOpenLog = $menu.Items.Add("Open daemon log")
$itemOpenLog.Add_Click({
    if (Test-Path $logPath) { Start-Process notepad.exe $logPath } else { [System.Windows.Forms.MessageBox]::Show("Log not found: $logPath") }
})

$itemOpenConfig = $menu.Items.Add("Open config folder")
$itemOpenConfig.Add_Click({
    Start-Process explorer.exe (Split-Path $snapshotPath)
})

$menu.Items.Add("-") | Out-Null

$itemQuit = $menu.Items.Add("Quit tray")
$itemQuit.Add_Click({
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu

# --- Update tick ---------------------------------------------------------
function Update-Tray {
    $snap = Read-Snapshot
    if (-not $snap) {
        $notify.Icon = New-StatusIcon "gray"
        $notify.Text = "UsageWatcher — no snapshot yet"
        $itemPrimary.Text   = "5h:  no data"
        $itemSecondary.Text = "Wk:  no data"
        $itemClaude.Text    = "Claude today: —"
        $itemUpdated.Text   = "Updated: —"
        return
    }

    $p  = $snap.codex.primary.used_percent
    $s  = $snap.codex.secondary.used_percent
    $resetsP = $snap.codex.primary.resets_at
    $resetsS = $snap.codex.secondary.resets_at
    $claudeCost = $snap.claude.today.cost_usd
    $claudeTok = ($snap.claude.today.input_tokens  + $snap.claude.today.output_tokens +
                  $snap.claude.today.cache_creation_input_tokens + $snap.claude.today.cache_read_input_tokens)
    $generated = $snap.generated_at

    $generatedDt = [DateTime]::Parse($generated)
    $ageMin = [int]((Get-Date).ToUniversalTime().Subtract($generatedDt.ToUniversalTime()).TotalMinutes)
    if ($ageMin -gt 5) { $status = "gray" } else { $status = Get-StatusFromPercent $p }

    $notify.Icon = New-StatusIcon $status
    $primaryTxt = if ($p -ne $null) { "{0}%" -f [int]$p } else { "—" }
    $secondaryTxt = if ($s -ne $null) { "{0}%" -f [int]$s } else { "—" }
    $notify.Text = "Codex 5h $primaryTxt · wk $secondaryTxt"

    $itemPrimary.Text   = "5h:  $primaryTxt (resets " + (Format-Countdown $resetsP) + ")"
    $itemSecondary.Text = "Wk:  $secondaryTxt (resets " + (Format-Countdown $resetsS) + ")"
    if ($claudeTok -ge 1000000) { $tokFmt = "{0:N1}M" -f ($claudeTok / 1000000.0) }
    elseif ($claudeTok -ge 1000) { $tokFmt = "{0:N0}k" -f ($claudeTok / 1000.0) }
    else { $tokFmt = "$claudeTok" }
    $itemClaude.Text = "Claude today: $tokFmt tok · `$$($claudeCost.ToString('F2'))"
    $itemUpdated.Text = "Updated: $ageMin min ago"
}

Update-Tray

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ Update-Tray })
$timer.Start()

[System.Windows.Forms.Application]::Run()
