import { parseCodexUsage } from "./parseCodex.js";
import { parseClaudeUsage } from "./parseClaude.js";
import { HOST } from "./paths.js";
import { loadConfig, CLAUDE_PLAN_LIMITS } from "./config.js";
import os from "node:os";

/**
 * Decorate the raw Claude parser output with primary (5h) / secondary (7d)
 * fields shaped like Codex's rate_limits, so the UI can render them uniformly.
 * Percentages are *estimates* — Anthropic doesn't publish exact limits and they
 * fluctuate, so the UI is expected to mark them with "~".
 */
function attachClaudeWindows(claude, planKey) {
  if (!claude || claude._error) return claude;
  const plan = CLAUDE_PLAN_LIMITS[planKey] || CLAUDE_PLAN_LIMITS.pro;
  const m5h = claude.messages_last_5h || 0;
  const m7d = claude.messages_last_7d || 0;

  let primary = null;
  if (plan.msgs_5h) {
    // Rolling 5h window. resets_at = earliest message in window + 5h.
    let resets_at = null;
    if (claude.window_5h_start_ts) {
      resets_at = Math.floor(new Date(claude.window_5h_start_ts).getTime() / 1000) + 5 * 3600;
    }
    primary = {
      used_percent: round1(Math.min(100, (m5h / plan.msgs_5h) * 100)),
      messages: m5h,
      limit: plan.msgs_5h,
      window_minutes: 300,
      resets_at,
      estimated: true,
    };
  }

  let secondary = null;
  if (plan.msgs_7d) {
    secondary = {
      used_percent: round1(Math.min(100, (m7d / plan.msgs_7d) * 100)),
      messages: m7d,
      limit: plan.msgs_7d,
      window_minutes: 10080,
      resets_at: null, // rolling 7d — no fixed reset
      estimated: true,
    };
  }

  return {
    ...claude,
    plan: planKey,
    plan_label: plan.label,
    primary,
    secondary,
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

export async function buildSnapshot() {
  const cfg = await loadConfig();
  const [codex, claudeRaw] = await Promise.all([
    parseCodexUsage().catch((err) => ({ _error: String(err) })),
    parseClaudeUsage().catch((err) => ({ _error: String(err) })),
  ]);
  const claude = attachClaudeWindows(claudeRaw, cfg.claudePlan);

  return {
    schema_version: 2,
    host: HOST,
    hostname: os.hostname(),
    generated_at: new Date().toISOString(),
    codex,
    claude,
  };
}
