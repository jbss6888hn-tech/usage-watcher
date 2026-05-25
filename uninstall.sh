#!/bin/bash
# uninstall.sh — removes everything install.sh put on this Mac. Does NOT delete
# the gist on github.com — pass --delete-gist to also remove it.
set -uo pipefail

DELETE_GIST=0
for arg in "$@"; do
    [ "$arg" = "--delete-gist" ] && DELETE_GIST=1
done

PLIST="$HOME/Library/LaunchAgents/com.arrenwang.usage-watcher.plist"
INSTALL_DIR="$HOME/.usage-watcher"
CONFIG_DIR="$HOME/.config/usage-watcher"
SWIFTBAR_PLUGIN="$HOME/Library/Application Support/SwiftBar/Plugins/usage.5s.sh"

echo "▸ Stopping daemon…"
launchctl unload "$PLIST" 2>/dev/null && echo "  ✓ launchd unloaded" || echo "  (not loaded)"
rm -f "$PLIST" && echo "  ✓ plist removed"

echo "▸ Removing SwiftBar plugin…"
rm -f "$SWIFTBAR_PLUGIN" && echo "  ✓ plugin removed"

if [ "$DELETE_GIST" = "1" ] && [ -f "$CONFIG_DIR/.env" ]; then
    GIST_ID="$(grep '^GIST_ID=' "$CONFIG_DIR/.env" | cut -d= -f2- | tr -d '"' )"
    if [ -n "$GIST_ID" ] && command -v gh >/dev/null 2>&1; then
        echo "▸ Deleting gist $GIST_ID…"
        gh gist delete "$GIST_ID" --yes 2>/dev/null && echo "  ✓ gist deleted" || echo "  (couldn't delete — do it manually at https://gist.github.com)"
    fi
fi

echo "▸ Removing local files…"
rm -rf "$INSTALL_DIR" && echo "  ✓ $INSTALL_DIR"
rm -rf "$CONFIG_DIR"  && echo "  ✓ $CONFIG_DIR"

echo
echo "✓ Uninstalled. iPhone widget can be removed manually (long-press → remove)."
