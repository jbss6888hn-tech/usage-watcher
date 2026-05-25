import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, SNAPSHOT_FILE, LOG_FILE } from "./paths.js";
import { buildSnapshot } from "./snapshot.js";
import { loadConfig } from "./config.js";
import { updateGistFile } from "./gist.js";

const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const NO_PUSH = args.includes("--no-push");

async function ensureConfigDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

async function writeLocalSnapshot(snapshot) {
  await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  // Best-effort append; never let log failure break the loop.
  fs.appendFile(LOG_FILE, line).catch(() => {});
}

async function runOnce() {
  const cfg = await loadConfig();
  const snap = await buildSnapshot();
  if (cfg.host) snap.host = cfg.host;
  await writeLocalSnapshot(snap);
  const codexPrimary = snap.codex?.primary?.used_percent ?? null;
  const codexSecondary = snap.codex?.secondary?.used_percent ?? null;
  const claudeToday = snap.claude?.today?.cost_usd ?? null;
  log(`snapshot host=${snap.host} codex_5h=${codexPrimary}% codex_wk=${codexSecondary}% claude_today_usd=${claudeToday}`);

  if (!NO_PUSH) {
    if (!cfg.gistId || !cfg.token) {
      log("gist push skipped (GIST_ID or GITHUB_TOKEN missing)");
      return snap;
    }
    const filename = `${snap.host}.json`;
    try {
      await updateGistFile({
        gistId: cfg.gistId,
        filename,
        contentJson: JSON.stringify(snap, null, 2),
        token: cfg.token,
      });
      log(`pushed ${filename} → gist ${cfg.gistId}`);
    } catch (err) {
      log(`gist push FAILED: ${err.message || err}`);
    }
  }

  return snap;
}

async function main() {
  await ensureConfigDir();
  if (ONCE) {
    await runOnce();
    return;
  }
  const cfg = await loadConfig();
  const intervalMs = Math.max(15, cfg.intervalSeconds) * 1000;
  log(`daemon starting; interval=${intervalMs / 1000}s`);

  // First tick immediately, then every interval.
  while (true) {
    const start = Date.now();
    try { await runOnce(); }
    catch (err) { log(`tick error: ${err.message || err}`); }
    const elapsed = Date.now() - start;
    const wait = Math.max(1000, intervalMs - elapsed);
    await new Promise((r) => setTimeout(r, wait));
  }
}

main().catch((err) => {
  log(`fatal: ${err?.stack || err}`);
  process.exit(1);
});
