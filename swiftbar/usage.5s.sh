#!/bin/bash
# <bitbar.title>Codex/Claude Usage</bitbar.title>
# <bitbar.version>v0.1</bitbar.version>
# <bitbar.author>usage-watcher</bitbar.author>
# <bitbar.desc>Codex 5h + weekly window % and Claude Code today tokens</bitbar.desc>
# <bitbar.dependencies>jq, node, usage-watcher</bitbar.dependencies>
# <swiftbar.environment>[VAR_USAGE_JSON=$HOME/.config/usage-watcher/usage.json]</swiftbar.environment>

set -u

SNAP="${VAR_USAGE_JSON:-$HOME/.config/usage-watcher/usage.json}"
JQ="$(command -v jq || true)"

if [ ! -f "$SNAP" ]; then
  echo "Usage —"
  echo "---"
  echo "no snapshot at $SNAP"
  echo "Run: cd ~/.usage-watcher && npm run once | terminal=true"
  exit 0
fi

# Use jq if available, otherwise fall back to a tiny node one-liner.
read_field() {
  local field="$1"
  if [ -n "$JQ" ]; then
    jq -r "$field // \"-\"" "$SNAP"
  else
    node -e "const d=require('$SNAP');const v=$2;process.stdout.write(v==null||v===undefined?'-':String(v))" 2>/dev/null || echo "-"
  fi
}

# Pull fields
CODEX_PRIMARY=$(jq -r '.codex.primary.used_percent // empty' "$SNAP" 2>/dev/null)
CODEX_SECONDARY=$(jq -r '.codex.secondary.used_percent // empty' "$SNAP" 2>/dev/null)
CODEX_RESETS_AT=$(jq -r '.codex.primary.resets_at // empty' "$SNAP" 2>/dev/null)
CODEX_WK_RESETS=$(jq -r '.codex.secondary.resets_at // empty' "$SNAP" 2>/dev/null)
CODEX_PRIMARY_STALE=$(jq -r '.codex.primary.stale // false' "$SNAP" 2>/dev/null)
CODEX_SECONDARY_STALE=$(jq -r '.codex.secondary.stale // false' "$SNAP" 2>/dev/null)
CODEX_PLAN=$(jq -r '.codex.plan_type // "?"' "$SNAP" 2>/dev/null)
CODEX_SAMPLE=$(jq -r '.codex.last_sample_at // "-"' "$SNAP" 2>/dev/null)

CLAUDE_TOKENS=$(jq -r '(.claude.today.input_tokens + .claude.today.output_tokens + .claude.today.cache_creation_input_tokens + .claude.today.cache_read_input_tokens) // 0' "$SNAP" 2>/dev/null)
CLAUDE_COST=$(jq -r '.claude.today.cost_usd // 0' "$SNAP" 2>/dev/null)
CLAUDE_MSGS=$(jq -r '.claude.messages_last_5h // 0' "$SNAP" 2>/dev/null)
CLAUDE_MSGS_7D=$(jq -r '.claude.messages_last_7d // 0' "$SNAP" 2>/dev/null)
CLAUDE_PRIMARY=$(jq -r '.claude.primary.used_percent // empty' "$SNAP" 2>/dev/null)
CLAUDE_SECONDARY=$(jq -r '.claude.secondary.used_percent // empty' "$SNAP" 2>/dev/null)
CLAUDE_PRIMARY_LIMIT=$(jq -r '.claude.primary.limit // empty' "$SNAP" 2>/dev/null)
CLAUDE_SECONDARY_LIMIT=$(jq -r '.claude.secondary.limit // empty' "$SNAP" 2>/dev/null)
CLAUDE_RESETS_AT=$(jq -r '.claude.primary.resets_at // empty' "$SNAP" 2>/dev/null)
CLAUDE_PLAN_LABEL=$(jq -r '.claude.plan_label // "?"' "$SNAP" 2>/dev/null)
CLAUDE_SAMPLE=$(jq -r '.claude.last_sample_at // "-"' "$SNAP" 2>/dev/null)

GENERATED_AT=$(jq -r '.generated_at // "-"' "$SNAP" 2>/dev/null)

# Format helpers
fmt_pct() {  # "45" → "45%", "" → "—"
  if [ -z "$1" ] || [ "$1" = "null" ]; then echo "—"; else printf "%d%%" "$(printf '%.0f' "$1")"; fi
}

fmt_countdown() {
  # arg = unix seconds in the future; output "Xh Ym" or "Xd Yh"
  local target="$1"
  [ -z "$target" ] || [ "$target" = "null" ] && { echo "—"; return; }
  local now=$(date +%s)
  local diff=$(( target - now ))
  if [ "$diff" -le 0 ]; then echo "window cycled"; return; fi
  if [ "$diff" -ge 86400 ]; then
    printf "%dd %dh" $(( diff / 86400 )) $(( (diff % 86400) / 3600 ))
  elif [ "$diff" -ge 3600 ]; then
    printf "%dh %dm" $(( diff / 3600 )) $(( (diff % 3600) / 60 ))
  else
    printf "%dm" $(( diff / 60 ))
  fi
}

# Returns 1 if the given unix-second target is already in the past.
is_past() {
  local target="$1"
  [ -z "$target" ] || [ "$target" = "null" ] && return 0
  local now=$(date +%s)
  [ "$target" -le "$now" ]
}

iso_to_epoch() {
  # Parse an ISO-8601 UTC timestamp (e.g. 2026-05-26T15:07:25.784Z) → unix seconds.
  # Strips optional trailing Z and fractional seconds, then parses as UTC.
  local ts="${1%Z}"; ts="${ts%.*}"
  TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "$ts" "+%s" 2>/dev/null
}

fmt_ago() {
  # arg = ISO timestamp; output "Xm ago" / "Xh ago" / "Xd ago"
  local ts="$1"
  [ -z "$ts" ] || [ "$ts" = "-" ] || [ "$ts" = "null" ] && { echo "—"; return; }
  local then now diff
  then=$(iso_to_epoch "$ts") || { echo "—"; return; }
  [ -z "$then" ] && { echo "—"; return; }
  now=$(date +%s)
  diff=$(( now - then ))
  if [ "$diff" -lt 60 ]; then echo "just now"
  elif [ "$diff" -lt 3600 ]; then printf "%dm ago" $(( diff / 60 ))
  elif [ "$diff" -lt 86400 ]; then printf "%dh ago" $(( diff / 3600 ))
  else printf "%dd ago" $(( diff / 86400 ))
  fi
}

fmt_tokens() {
  # arg = integer; output "1.2M", "234k", "42"
  local n="$1"
  [ -z "$n" ] && n=0
  if [ "$n" -ge 1000000 ]; then printf "%.1fM" "$(echo "scale=2; $n / 1000000" | bc)"
  elif [ "$n" -ge 1000 ]; then printf "%dk" $(( n / 1000 ))
  else printf "%d" "$n"
  fi
}

# Determine if data is stale (Codex sample > 24h or daemon generated_at > 5min)
DAEMON_AGE_SEC=0
if [ "$GENERATED_AT" != "-" ] && [ "$GENERATED_AT" != "null" ]; then
  GEN_EPOCH=$(iso_to_epoch "$GENERATED_AT")
  [ -z "$GEN_EPOCH" ] && GEN_EPOCH=0
  NOW=$(date +%s)
  DAEMON_AGE_SEC=$(( NOW - GEN_EPOCH ))
fi
STALE_FLAG=""
if [ "$DAEMON_AGE_SEC" -gt 300 ]; then STALE_FLAG="⚠ "; fi

# Use the stale flag computed by snapshot.js (covers both "window cycled past
# resets_at" and "sample older than the window itself").
PRIMARY_STALE=0
SECONDARY_STALE=0
[ "$CODEX_PRIMARY_STALE" = "true" ] && PRIMARY_STALE=1
[ "$CODEX_SECONDARY_STALE" = "true" ] && SECONDARY_STALE=1

# === Menu bar title (one short line) ===
# Format: [codex-icon] codex5h | codexWk · [claude-icon] ~claude5h | ~claudeWk
PRIMARY_TXT=$(fmt_pct "$CODEX_PRIMARY")
SECONDARY_TXT=$(fmt_pct "$CODEX_SECONDARY")
[ "$PRIMARY_STALE" = "1" ] && PRIMARY_TXT="—"
[ "$SECONDARY_STALE" = "1" ] && SECONDARY_TXT="—"
CLAUDE_P_TXT=$(fmt_pct "$CLAUDE_PRIMARY")
CLAUDE_S_TXT=$(fmt_pct "$CLAUDE_SECONDARY")
# Prefix ~ for Claude (estimates), only when value is numeric.
[ "$CLAUDE_P_TXT" != "—" ] && CLAUDE_P_TXT="~${CLAUDE_P_TXT}"
[ "$CLAUDE_S_TXT" != "—" ] && CLAUDE_S_TXT="~${CLAUDE_S_TXT}"
echo "${STALE_FLAG}◐${PRIMARY_TXT}│${SECONDARY_TXT}  ✦${CLAUDE_P_TXT}│${CLAUDE_S_TXT}"

# === Dropdown ===
echo "---"
echo "Codex ${CODEX_PLAN}"
if [ "$PRIMARY_STALE" = "1" ] && [ "$SECONDARY_STALE" = "1" ]; then
  echo "⚠ data is $(fmt_ago "$CODEX_SAMPLE") — desktop Codex.app | font='Menlo' color=#c0392b"
  echo "  not tracked (only Codex CLI / VS Code) | font='Menlo' color=#888"
  echo "  open Codex CLI / VS Code to refresh | font='Menlo' color=#888"
else
  if [ "$PRIMARY_STALE" = "1" ]; then
    echo "5h window: $(fmt_pct "$CODEX_PRIMARY")* (stale) | font='Menlo' color=#888"
    echo "  * sample $(fmt_ago "$CODEX_SAMPLE") — window cycled | font='Menlo' color=#888"
  else
    echo "5h window: ${PRIMARY_TXT} used | font='Menlo'"
    echo "  resets in $(fmt_countdown "$CODEX_RESETS_AT") | font='Menlo' color=#888"
  fi
  if [ "$SECONDARY_STALE" = "1" ]; then
    echo "Weekly: $(fmt_pct "$CODEX_SECONDARY")* (stale) | font='Menlo' color=#888"
    echo "  * sample $(fmt_ago "$CODEX_SAMPLE") — desktop usage not seen | font='Menlo' color=#888"
  else
    echo "Weekly: ${SECONDARY_TXT} used | font='Menlo'"
    echo "  resets in $(fmt_countdown "$CODEX_WK_RESETS") | font='Menlo' color=#888"
  fi
fi
echo "  last sample $(fmt_ago "$CODEX_SAMPLE") | font='Menlo' color=#888"

echo "---"
echo "Claude Code (${CLAUDE_PLAN_LABEL}) — limits are estimates"
if [ -n "$CLAUDE_PRIMARY" ] && [ "$CLAUDE_PRIMARY" != "null" ]; then
  echo "5h window: ~$(fmt_pct "$CLAUDE_PRIMARY") (~${CLAUDE_MSGS}/${CLAUDE_PRIMARY_LIMIT} msgs) | font='Menlo'"
  if [ -n "$CLAUDE_RESETS_AT" ] && [ "$CLAUDE_RESETS_AT" != "null" ]; then
    echo "  oldest msg ages out in $(fmt_countdown "$CLAUDE_RESETS_AT") | font='Menlo' color=#888"
  fi
fi
if [ -n "$CLAUDE_SECONDARY" ] && [ "$CLAUDE_SECONDARY" != "null" ]; then
  echo "Weekly: ~$(fmt_pct "$CLAUDE_SECONDARY") (~${CLAUDE_MSGS_7D}/${CLAUDE_SECONDARY_LIMIT} msgs) | font='Menlo'"
  echo "  rolling 7-day window | font='Menlo' color=#888"
fi
echo "Today: $(fmt_tokens "$CLAUDE_TOKENS") tokens | font='Menlo'"
echo "  est cost \$$CLAUDE_COST | font='Menlo' color=#888"
echo "  last sample $(fmt_ago "$CLAUDE_SAMPLE") | font='Menlo' color=#888"

echo "---"
echo "Daemon snapshot $(fmt_ago "$GENERATED_AT") | font='Menlo' color=#888"
if [ "$DAEMON_AGE_SEC" -gt 300 ]; then
  echo "⚠ stale (daemon may be stopped) | color=#c0392b"
fi

echo "---"
echo "↻ Force refresh now | bash='/usr/bin/env' param1='node' param2=$HOME/.usage-watcher/src/index.js param3='--once' terminal=false refresh=true"
echo "📂 Open snapshot folder | bash='/usr/bin/open' param1=$HOME/.config/usage-watcher terminal=false"
echo "📜 Open daemon log | bash='/usr/bin/open' param1=$HOME/.config/usage-watcher/daemon.log terminal=false"
echo "Refresh | refresh=true"
