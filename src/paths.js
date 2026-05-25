import os from "node:os";
import path from "node:path";

const home = os.homedir();
export const HOST = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";

export const CODEX_SESSIONS_DIR = path.join(home, ".codex", "sessions");
export const CLAUDE_PROJECTS_DIR = path.join(home, ".claude", "projects");

const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
export const CONFIG_DIR = path.join(xdgConfig, "usage-watcher");
export const ENV_FILE = path.join(CONFIG_DIR, ".env");
export const STATE_FILE = path.join(CONFIG_DIR, "state.json");
export const SNAPSHOT_FILE = path.join(CONFIG_DIR, "usage.json");
export const LOG_FILE = path.join(CONFIG_DIR, "daemon.log");
