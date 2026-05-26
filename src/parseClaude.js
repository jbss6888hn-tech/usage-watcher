import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_PROJECTS_DIR } from "./paths.js";
import { costUSD, priceForModel } from "./pricing.js";

async function walkJsonl(dir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip subagent traces — they double-count the same token usage that already
      // appears in the parent session's JSONL.
      if (e.name === "subagents") continue;
      out.push(...await walkJsonl(full));
    } else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

function startOfTodayUTC() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function startOfTodayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function emptyBucket() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    messages: 0,
    cost_usd: 0,
  };
}

function addUsage(bucket, model, u) {
  const inp = u.input_tokens || 0;
  const out = u.output_tokens || 0;
  const cw = u.cache_creation_input_tokens || 0;
  const cr = u.cache_read_input_tokens || 0;
  bucket.input_tokens += inp;
  bucket.output_tokens += out;
  bucket.cache_creation_input_tokens += cw;
  bucket.cache_read_input_tokens += cr;
  bucket.messages += 1;
  bucket.cost_usd += costUSD({
    model,
    input_tokens: inp,
    output_tokens: out,
    cache_creation_input_tokens: cw,
    cache_read_input_tokens: cr,
  });
}

/**
 * Walk all Claude project JSONLs, aggregate usage:
 *  - today (local) totals
 *  - by-model totals (today)
 *  - messages in last 5h (rough proxy for 5h plan window)
 *
 * Dedupes by message.id so retries/replays don't double-count.
 */
export async function parseClaudeUsage() {
  const files = await walkJsonl(CLAUDE_PROJECTS_DIR);
  const today = emptyBucket();
  const byModel = new Map(); // modelId -> bucket
  const seenIds = new Set();
  let last5hCount = 0;
  let last7dCount = 0;
  let tokens5h = 0;
  let tokens7d = 0;
  let earliestTs5h = null; // first message inside the rolling 5h window
  let latestTs = null;

  const todayStart = startOfTodayLocal();
  const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const file of files) {
    let text;
    try { text = await fs.readFile(file, "utf8"); }
    catch { continue; }

    const lines = text.split("\n");
    for (const line of lines) {
      if (!line || line.length < 20) continue;
      // Cheap pre-filter
      if (!line.includes('"usage"')) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj?.type !== "assistant") continue;
      const msg = obj.message;
      if (!msg?.usage) continue;
      const id = msg.id;
      if (id) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      const ts = obj.timestamp;
      if (!ts) continue;
      if (!latestTs || ts > latestTs) latestTs = ts;
      const model = msg.model || "unknown";

      if (ts >= todayStart) {
        addUsage(today, model, msg.usage);
        if (!byModel.has(model)) byModel.set(model, emptyBucket());
        addUsage(byModel.get(model), model, msg.usage);
      }
      const inp = msg.usage.input_tokens || 0;
      const out = msg.usage.output_tokens || 0;
      const cw  = msg.usage.cache_creation_input_tokens || 0;
      const cr  = msg.usage.cache_read_input_tokens || 0;
      const totalTok = inp + out + cw + cr;
      if (ts >= fiveHoursAgo) {
        last5hCount += 1;
        tokens5h += totalTok;
        if (!earliestTs5h || ts < earliestTs5h) earliestTs5h = ts;
      }
      if (ts >= sevenDaysAgo) {
        last7dCount += 1;
        tokens7d += totalTok;
      }
    }
  }

  // Round cost to 4 decimals for cleaner JSON
  today.cost_usd = round4(today.cost_usd);
  const byModelObj = {};
  for (const [m, b] of byModel.entries()) {
    b.cost_usd = round4(b.cost_usd);
    byModelObj[m] = b;
  }

  return {
    today,
    by_model: byModelObj,
    messages_last_5h: last5hCount,
    messages_last_7d: last7dCount,
    tokens_last_5h: tokens5h,
    tokens_last_7d: tokens7d,
    window_5h_start_ts: earliestTs5h,  // ISO of first msg inside the rolling 5h window
    last_sample_at: latestTs,
  };
}

function round4(n) { return Math.round(n * 10000) / 10000; }
