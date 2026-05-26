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
function attachClaudeWindows(claude, planKey, overrides) {
  if (!claude || claude._error) return claude;
  const plan = CLAUDE_PLAN_LIMITS[planKey] || CLAUDE_PLAN_LIMITS.pro;
  const limit5h = overrides.claude5hLimit ?? plan.msgs_5h;
  const limit7d = overrides.claude7dLimit ?? plan.msgs_7d;
  const m5h = claude.messages_last_5h || 0;
  const m7d = claude.messages_last_7d || 0;

  let primary = null;
  if (limit5h) {
    // Rolling 5h window. resets_at = earliest message in window + 5h.
    let resets_at = null;
    if (claude.window_5h_start_ts) {
      resets_at = Math.floor(new Date(claude.window_5h_start_ts).getTime() / 1000) + 5 * 3600;
    }
    primary = {
      used_percent: round1(Math.min(100, (m5h / limit5h) * 100)),
      messages: m5h,
      limit: limit5h,
      window_minutes: 300,
      resets_at,
      estimated: true,
      calibrated: overrides.claude5hLimit != null,
    };
  }

  let secondary = null;
  if (limit7d) {
    secondary = {
      used_percent: round1(Math.min(100, (m7d / limit7d) * 100)),
      messages: m7d,
      limit: limit7d,
      window_minutes: 10080,
      resets_at: null, // rolling 7d — no fixed reset
      estimated: true,
      calibrated: overrides.claude7dLimit != null,
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

/**
 * Codex CLI / VS Code extension samples can go stale if the user only uses the
 * desktop Codex.app (which doesn't write rollouts with rate_limits locally).
 * Mark each window's used_percent as null when the sample is older than the
 * window itself — at that point we cannot infer anything reliable.
 */
function markStaleCodex(codex) {
  if (!codex || codex._error) return codex;
  const sampleAtTs = codex.last_sample_at ? Date.parse(codex.last_sample_at) / 1000 : null;
  const now = Math.floor(Date.now() / 1000);
  const sampleAgeSec = sampleAtTs ? now - sampleAtTs : Infinity;

  const out = { ...codex };
  if (out.primary) {
    const cycledByResetsAt = out.primary.resets_at && out.primary.resets_at <= now;
    const olderThanWindow  = sampleAgeSec > (out.primary.window_minutes || 300) * 60;
    out.primary = {
      ...out.primary,
      stale: cycledByResetsAt || olderThanWindow,
      sample_age_sec: sampleAgeSec === Infinity ? null : sampleAgeSec,
    };
  }
  if (out.secondary) {
    const cycledByResetsAt = out.secondary.resets_at && out.secondary.resets_at <= now;
    const olderThanWindow  = sampleAgeSec > (out.secondary.window_minutes || 10080) * 60;
    out.secondary = {
      ...out.secondary,
      stale: cycledByResetsAt || olderThanWindow,
      sample_age_sec: sampleAgeSec === Infinity ? null : sampleAgeSec,
    };
  }
  return out;
}

function round1(n) { return Math.round(n * 10) / 10; }

export async function buildSnapshot() {
  const cfg = await loadConfig();
  const [codexRaw, claudeRaw] = await Promise.all([
    parseCodexUsage().catch((err) => ({ _error: String(err) })),
    parseClaudeUsage().catch((err) => ({ _error: String(err) })),
  ]);
  const codex  = markStaleCodex(codexRaw);
  const claude = attachClaudeWindows(claudeRaw, cfg.claudePlan, {
    claude5hLimit: cfg.claude5hLimit,
    claude7dLimit: cfg.claude7dLimit,
  });

  return {
    schema_version: 2,
    host: HOST,
    hostname: os.hostname(),
    generated_at: new Date().toISOString(),
    codex,
    claude,
  };
}
