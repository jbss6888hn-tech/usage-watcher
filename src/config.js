import fs from "node:fs/promises";
import { ENV_FILE } from "./paths.js";

export async function loadEnv() {
  let text = "";
  try { text = await fs.readFile(ENV_FILE, "utf8"); }
  catch { return {}; }

  const env = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

export async function loadConfig() {
  const fileEnv = await loadEnv();
  const merged = { ...fileEnv, ...envOverrides() };
  return {
    gistId: merged.GIST_ID || "",
    token: merged.GITHUB_TOKEN || "",
    host: merged.HOST || "",            // optional override of mac/win
    intervalSeconds: Number(merged.INTERVAL_SECONDS || 60),
    claudePlan: (merged.CLAUDE_PLAN || "pro").toLowerCase(), // pro | max5 | max20 | api
    // Per-user calibration. If unset, falls back to the plan's default limits.
    // Tune these by comparing our % to what claude.ai shows in your Usage panel.
    claude5hLimit:  toIntOrNull(merged.CLAUDE_5H_LIMIT_MSGS),
    claude7dLimit:  toIntOrNull(merged.CLAUDE_7D_LIMIT_MSGS),
  };
}

function envOverrides() {
  const o = {};
  for (const k of ["GIST_ID", "GITHUB_TOKEN", "HOST", "INTERVAL_SECONDS",
                   "CLAUDE_PLAN", "CLAUDE_5H_LIMIT_MSGS", "CLAUDE_7D_LIMIT_MSGS"]) {
    if (process.env[k]) o[k] = process.env[k];
  }
  return o;
}

function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Default Claude Code plan limits — based on Anthropic's published rough
 * guidance. Anthropic's real limits fluctuate (and the algorithm probably uses
 * tokens, not raw message count), so these are starting points only. Use
 * CLAUDE_5H_LIMIT_MSGS / CLAUDE_7D_LIMIT_MSGS in .env to calibrate based on
 * what your claude.ai Usage panel actually shows.
 */
export const CLAUDE_PLAN_LIMITS = {
  pro:   { msgs_5h:   85, msgs_7d:  600, label: "Pro" },   // bumped from 45/225 — closer to reality per user calibration
  max5:  { msgs_5h:  225, msgs_7d: 1125, label: "Max 5x" },
  max20: { msgs_5h:  900, msgs_7d: 4500, label: "Max 20x" },
  api:   { msgs_5h: null, msgs_7d: null, label: "API" },   // no plan limits
};
