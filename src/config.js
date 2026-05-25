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
  };
}

function envOverrides() {
  const o = {};
  for (const k of ["GIST_ID", "GITHUB_TOKEN", "HOST", "INTERVAL_SECONDS"]) {
    if (process.env[k]) o[k] = process.env[k];
  }
  return o;
}
