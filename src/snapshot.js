import { parseCodexUsage } from "./parseCodex.js";
import { parseClaudeUsage } from "./parseClaude.js";
import { HOST } from "./paths.js";
import os from "node:os";

export async function buildSnapshot() {
  const [codex, claude] = await Promise.all([
    parseCodexUsage().catch((err) => ({ _error: String(err) })),
    parseClaudeUsage().catch((err) => ({ _error: String(err) })),
  ]);

  return {
    schema_version: 1,
    host: HOST,
    hostname: os.hostname(),
    generated_at: new Date().toISOString(),
    codex,
    claude,
  };
}
