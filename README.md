# usage-watcher

Watch your **Codex** and **Claude Code** usage from a Mac menu-bar icon, a
Windows tray icon, and an iPhone widget. **Zero tokens consumed** — everything
is parsed from local log files (`~/.codex/sessions/**/*.jsonl`,
`~/.claude/projects/**/*.jsonl`) and synced via a tiny private GitHub Gist.

## What you see

- **Codex 5h window % used** (the primary rate limit that bites first)
- **Codex weekly window % used**
- **Claude Code today**: tokens, estimated USD cost, messages in last 5h
- All three numbers visible at-a-glance on Mac menu bar, Windows tray, and
  iPhone lock-screen or home-screen widget.

## Quick install

### macOS
```sh
curl -fsSL https://raw.githubusercontent.com/jbss6888hn-tech/usage-watcher/main/install.sh | bash
```
This will install Homebrew/Node/gh/SwiftBar if missing, authenticate with
GitHub (opens browser once for `gist` scope), auto-create a private gist,
register the daemon under launchd, drop the SwiftBar plugin, and print a QR
code for iPhone setup.

### Windows (PowerShell as your user, not Admin)
```powershell
irm https://raw.githubusercontent.com/jbss6888hn-tech/usage-watcher/main/install.ps1 | iex
```
Installs Node/gh via winget if missing, authenticates GitHub, creates a gist,
registers `UsageWatcherDaemon` and `UsageWatcherTray` as logon Scheduled Tasks.

### iPhone (after Mac OR Windows installer ran)
1. Install **Scriptable** from the App Store (free).
2. Scan the QR code printed by the desktop installer with your iPhone camera,
   or open the `scriptable://add?...` URL on iPhone Safari.
3. Tap **Add** in Scriptable → tap ▶ Run → paste your GitHub PAT once (stored
   in iOS Keychain).
4. Long-press home/lock screen → **+** → **Scriptable** → choose `UsageWidget`.

## How it works

```
~/.codex/sessions/*.jsonl   ~/.claude/projects/**/*.jsonl
            │                            │
            ▼                            ▼
      ┌──────────────────────────────────────┐
      │  Node daemon (this repo)            │
      │  • parses local files                │
      │  • aggregates per-day / per-model    │
      │  • picks newest Codex rate_limits    │
      │  • PATCHes a single private gist     │
      └──────────────────┬───────────────────┘
                         │ HTTPS
            ┌────────────┼────────────┐
            ▼            ▼            ▼
        SwiftBar    Windows tray   iPhone
        (macOS)    (PowerShell)    Scriptable
```

Two machines each push their own file (`mac.json` / `win.json`) into the same
gist; the iPhone widget merges them and shows whichever has the most recent
Codex `rate_limits` sample.

## Repository layout

```
usage-watcher/
├── src/                      Node.js daemon (ESM, no deps)
│   ├── index.js              main loop / --once mode
│   ├── parseCodex.js         tail Codex JSONLs → latest rate_limits
│   ├── parseClaude.js        scan Claude JSONLs → today/by-model/cost
│   ├── pricing.js            Anthropic model USD pricing
│   ├── snapshot.js           builds the unified usage.json payload
│   ├── gist.js               PATCH a file inside a private gist
│   ├── config.js             reads ~/.config/usage-watcher/.env
│   └── paths.js              cross-platform paths
├── install.sh                One-line macOS installer
├── install.ps1               One-line Windows installer
├── install/mac.launchd.plist Daemon launchd template (placeholders replaced
│                             at install time)
├── swiftbar/usage.5s.sh      macOS menu-bar plugin (SwiftBar)
├── windows/tray.ps1          Windows system-tray (PowerShell NotifyIcon)
└── ios-widget/UsageWidget.js Scriptable widget script
```

## Manual / dev usage

```sh
# Run once and print to local file only (don't push to gist)
npm run snapshot

# Run once and push to gist
npm run once

# Run daemon loop
npm start
```

## Configuration

`~/.config/usage-watcher/.env` (chmod 600) — populated by the installer:

| Key              | Meaning                                                |
|------------------|--------------------------------------------------------|
| `GIST_ID`        | the private gist created at install                    |
| `GITHUB_TOKEN`   | PAT with `gist` scope                                  |
| `HOST`           | `mac` or `win` (used to pick filename inside the gist) |
| `INTERVAL_SECONDS` | how often the daemon ticks. Default 60s              |

## Uninstall

### macOS
```sh
launchctl unload ~/Library/LaunchAgents/com.arrenwang.usage-watcher.plist
rm  ~/Library/LaunchAgents/com.arrenwang.usage-watcher.plist
rm  "$HOME/Library/Application Support/SwiftBar/Plugins/usage.5s.sh"
rm -rf ~/.usage-watcher ~/.config/usage-watcher
```

### Windows (PowerShell)
```powershell
Unregister-ScheduledTask -TaskName UsageWatcherDaemon -Confirm:$false
Unregister-ScheduledTask -TaskName UsageWatcherTray   -Confirm:$false
Remove-Item -Recurse -Force "$env:USERPROFILE\.usage-watcher"
Remove-Item -Recurse -Force "$env:USERPROFILE\.config\usage-watcher"
```

### iPhone
Just remove the widget and delete the `UsageWidget` script in Scriptable.

## Privacy / security notes

- All log parsing is local. Nothing about your prompts or code is read or
  uploaded — only token counts, rate-limit percentages, and model names.
- The gist is **private**. It contains no secrets, only the numbers shown in
  the UI. You can mark it as public if you really want to share usage stats.
- The PAT is stored at `~/.config/usage-watcher/.env` (chmod 600 on macOS,
  ACL'd to current user on Windows) and in iOS Keychain on iPhone.
