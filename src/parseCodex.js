import fs from "node:fs/promises";
import path from "node:path";
import { CODEX_SESSIONS_DIR } from "./paths.js";

async function walkJsonl(dir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkJsonl(full));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

/**
 * Read the tail of a file (last N bytes) as utf-8 text.
 * Codex sessions can be many MB; we only need the last token_count event,
 * which lives near the end. 256KB is plenty.
 */
async function readTail(file, bytes = 256 * 1024) {
  const fh = await fs.open(file, "r");
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    await fh.close();
  }
}

/**
 * Find the latest `event_msg / token_count` event across all Codex sessions.
 * Returns the parsed payload (with rate_limits) plus its timestamp + session id,
 * or null if none found.
 */
export async function parseCodexUsage() {
  const files = await walkJsonl(CODEX_SESSIONS_DIR);
  let best = null; // { ts, sessionId, payload }

  for (const file of files) {
    let text;
    try { text = await readTail(file); }
    catch { continue; }

    // We grabbed a tail of the file, so the first line may be partial — drop it
    // unless we read the whole file (start was 0).
    const fileSize = (await fs.stat(file)).size;
    if (fileSize > text.length) {
      const nlIdx = text.indexOf("\n");
      if (nlIdx >= 0) text = text.slice(nlIdx + 1);
    }

    const lines = text.split("\n");
    // Walk from end to find latest token_count with non-null rate_limits
    let foundForThisFile = false;
    for (let i = lines.length - 1; i >= 0 && !foundForThisFile; i--) {
      const line = lines[i];
      if (!line || !line.includes("token_count")) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj?.type !== "event_msg") continue;
      if (obj?.payload?.type !== "token_count") continue;
      // Some token_count events have rate_limits: null (e.g. when codex never queried).
      // Skip those — we want the most recent event that actually carries limit data.
      if (!obj.payload?.rate_limits) continue;
      const ts = obj.timestamp || obj.payload?.timestamp;
      if (!ts) continue;
      if (!best || ts > best.ts) {
        const sessionId = path.basename(file).replace(/^rollout-[\dT-]+-/, "").replace(/\.jsonl$/, "");
        best = { ts, sessionId, file, payload: obj.payload };
      }
      foundForThisFile = true;
    }
  }

  if (!best) return null;

  const rate_limits = best.payload.rate_limits || {};
  const info = best.payload.info || {};
  return {
    plan_type: rate_limits.plan_type ?? null,
    rate_limit_reached_type: rate_limits.rate_limit_reached_type ?? null,
    primary: rate_limits.primary ?? null,
    secondary: rate_limits.secondary ?? null,
    credits: rate_limits.credits ?? null,
    last_sample_at: best.ts,
    last_session_id: best.sessionId,
    cumulative_tokens: info?.total_token_usage ?? null,
    model_context_window: info?.model_context_window ?? null,
  };
}
