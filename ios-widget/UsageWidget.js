// variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: chart-pie;

// =============================================================================
// UsageWidget.js — Codex / Claude Code usage on your iPhone
//
//   • Reads a private GitHub Gist (mac.json + win.json) produced by the
//     `usage-watcher` daemon running on your Mac/Windows.
//   • Renders 4 widget sizes: small / medium / lock-circular / lock-rectangular.
//   • Zero token cost — only fetches a tiny JSON over HTTPS.
//
// First-time setup:
//   1. On Mac/Windows you ran the installer which created a private gist.
//   2. The installer printed a QR — scan it and tap "Add" in Scriptable.
//   3. Open the script in Scriptable → tap ▶ Run.
//        - It will ask for your GitHub PAT (paste once, stored in Keychain).
//        - Gist ID is filled from the QR (or you'll be asked).
//   4. Long-press home/lock screen → + → Scriptable → choose widget size.
//   5. Edit widget → Script: UsageWidget → When Interacting: Run Script.
// =============================================================================

const KEY_GIST_ID = "usageWatcher.gistId";
const KEY_TOKEN   = "usageWatcher.token";

// ---------- 0. Config: read query params, fall back to Keychain prompts ----------

async function loadConfig() {
  // Query params come from scriptable:///add?gistId=...&token=...
  const qp = (args && args.queryParameters) || {};

  let gistId = qp.gistId || (Keychain.contains(KEY_GIST_ID) ? Keychain.get(KEY_GIST_ID) : "");
  let token  = qp.token  || (Keychain.contains(KEY_TOKEN)   ? Keychain.get(KEY_TOKEN)   : "");

  // Only prompt when running in foreground (not from the widget host).
  if (config.runsInWidget) {
    return { gistId, token };
  }

  if (!gistId) {
    const a = new Alert();
    a.title = "Gist ID";
    a.message = "Paste the Gist ID printed by the install.sh script on your Mac.";
    a.addTextField("Gist ID", "");
    a.addAction("Save");
    a.addCancelAction("Cancel");
    if ((await a.presentAlert()) === -1) throw new Error("setup cancelled");
    gistId = a.textFieldValue(0).trim();
  }
  if (!token) {
    const a = new Alert();
    a.title = "GitHub PAT";
    a.message = "Paste a GitHub personal access token with 'gist' scope. It will be stored in iOS Keychain, never sent anywhere except api.github.com.";
    a.addSecureTextField("PAT", "");
    a.addAction("Save");
    a.addCancelAction("Cancel");
    if ((await a.presentAlert()) === -1) throw new Error("setup cancelled");
    token = a.textFieldValue(0).trim();
  }

  if (gistId) Keychain.set(KEY_GIST_ID, gistId);
  if (token)  Keychain.set(KEY_TOKEN, token);
  return { gistId, token };
}

// ---------- 1. Fetch gist ----------

async function fetchGist({ gistId, token }) {
  if (!gistId || !token) throw new Error("Missing gistId or PAT");
  const req = new Request(`https://api.github.com/gists/${gistId}`);
  req.headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "scriptable-usage-widget",
  };
  const data = await req.loadJSON();
  const files = data.files || {};
  const out = {};
  for (const name of Object.keys(files)) {
    try { out[name] = JSON.parse(files[name].content); }
    catch { /* skip non-JSON */ }
  }
  return out;
}

// ---------- 2. Merge snapshots (pick newest codex sample across hosts) ----------

function pickNewer(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return (a.last_sample_at || "") >= (b.last_sample_at || "") ? a : b;
}

function mergeSnapshots(gistFiles) {
  const snaps = Object.values(gistFiles).filter((x) => x && x.schema_version === 1);
  if (snaps.length === 0) {
    return { _empty: true };
  }
  let codex = null, claude = null, generatedAt = null, hosts = [];
  for (const s of snaps) {
    if (s.host) hosts.push(s.host);
    if (s.generated_at && (!generatedAt || s.generated_at > generatedAt)) generatedAt = s.generated_at;
    if (s.codex && !s.codex._error) codex = pickNewer(codex, s.codex);
    if (s.claude && !s.claude._error) {
      claude = pickNewer(claude, { ...s.claude, _host: s.host });
    }
  }
  return { codex, claude, generated_at: generatedAt, hosts };
}

// ---------- 3. Formatting helpers ----------

function pct(n) {
  if (n === null || n === undefined) return "—";
  return Math.round(n) + "%";
}

function countdown(unixSec) {
  if (!unixSec) return "—";
  const now = Date.now() / 1000;
  const diff = unixSec - now;
  if (diff <= 0) return "reset";
  if (diff >= 86400) return Math.floor(diff / 86400) + "d " + Math.floor((diff % 86400) / 3600) + "h";
  if (diff >= 3600)  return Math.floor(diff / 3600)  + "h " + Math.floor((diff % 3600) / 60) + "m";
  return Math.floor(diff / 60) + "m";
}

function ago(isoTs) {
  if (!isoTs) return "—";
  const t = Date.parse(isoTs);
  if (Number.isNaN(t)) return "—";
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m";
  if (diff < 86400) return Math.floor(diff / 3600) + "h";
  return Math.floor(diff / 86400) + "d";
}

function fmtTokens(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1000) + "k";
  return String(n);
}

function colorForPercent(p) {
  if (p === null || p === undefined) return new Color("#888888");
  if (p >= 85) return new Color("#e74c3c"); // red
  if (p >= 60) return new Color("#f1c40f"); // yellow
  return new Color("#2ecc71");              // green
}

// ---------- 4. Ring drawing (Canvas) ----------

function drawRing(percent, sizePx, label) {
  const ctx = new DrawContext();
  ctx.size = new Size(sizePx, sizePx);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const cx = sizePx / 2;
  const cy = sizePx / 2;
  const radius = sizePx * 0.42;
  const thickness = sizePx * 0.13;

  // Background ring
  const bgPath = new Path();
  bgPath.addEllipse(new Rect(cx - radius, cy - radius, radius * 2, radius * 2));
  ctx.setStrokeColor(new Color("#888888", 0.25));
  ctx.setLineWidth(thickness);
  ctx.addPath(bgPath);
  ctx.strokePath();

  // Foreground arc — approximate by drawing many small line segments
  const pct = Math.max(0, Math.min(100, percent || 0));
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (pct / 100) * Math.PI * 2;
  const fgColor = colorForPercent(pct);

  const arcPath = new Path();
  const steps = 64;
  const segEnd = startAngle + Math.max(endAngle - startAngle, 0.0001);
  for (let i = 0; i <= steps; i++) {
    const t = startAngle + ((segEnd - startAngle) * i) / steps;
    const x = cx + radius * Math.cos(t);
    const y = cy + radius * Math.sin(t);
    if (i === 0) arcPath.move(new Point(x, y));
    else arcPath.addLine(new Point(x, y));
  }
  ctx.setStrokeColor(fgColor);
  ctx.setLineWidth(thickness);
  ctx.addPath(arcPath);
  ctx.strokePath();

  // Center text: percentage
  const pctText = percent === null || percent === undefined ? "—" : Math.round(percent) + "%";
  const fontSize = sizePx * 0.22;
  ctx.setFont(Font.boldSystemFont(fontSize));
  ctx.setTextColor(Color.dynamic(new Color("#222"), new Color("#f5f5f5")));
  ctx.setTextAlignedCenter();
  const tw = fontSize * 2.6;
  ctx.drawTextInRect(pctText, new Rect(cx - tw / 2, cy - fontSize * 0.6, tw, fontSize * 1.2));

  if (label) {
    const labelSize = sizePx * 0.11;
    ctx.setFont(Font.systemFont(labelSize));
    ctx.setTextColor(new Color("#888888"));
    ctx.drawTextInRect(label, new Rect(cx - tw / 2, cy + fontSize * 0.55, tw, labelSize * 1.4));
  }
  return ctx.getImage();
}

// ---------- 5. Widget builders ----------

function applyBaseStyle(widget) {
  widget.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#0e1217"));
  widget.setPadding(12, 12, 12, 12);
}

function emptyWidget(message) {
  const w = new ListWidget();
  applyBaseStyle(w);
  const title = w.addText("UsageWatcher");
  title.font = Font.boldSystemFont(14);
  w.addSpacer(6);
  const t = w.addText(message);
  t.font = Font.systemFont(11);
  t.textColor = new Color("#888");
  return w;
}

function buildSmall(data) {
  const w = new ListWidget();
  applyBaseStyle(w);

  // Title row
  const titleRow = w.addStack();
  const title = titleRow.addText("Codex");
  title.font = Font.semiboldSystemFont(11);
  titleRow.addSpacer();
  const plan = titleRow.addText((data.codex?.plan_type || "").toUpperCase());
  plan.font = Font.systemFont(9);
  plan.textColor = new Color("#888");

  w.addSpacer(4);

  // Two rings
  const ringRow = w.addStack();
  ringRow.layoutHorizontally();
  ringRow.centerAlignContent();

  const ringSize = 60;
  const primary = data.codex?.primary?.used_percent ?? null;
  const secondary = data.codex?.secondary?.used_percent ?? null;

  const left = ringRow.addImage(drawRing(primary, ringSize * 2, "5h"));
  left.imageSize = new Size(ringSize, ringSize);
  ringRow.addSpacer(8);
  const right = ringRow.addImage(drawRing(secondary, ringSize * 2, "wk"));
  right.imageSize = new Size(ringSize, ringSize);

  w.addSpacer(4);

  // Footer: resets countdown + stale flag
  const fr = w.addStack();
  fr.layoutHorizontally();
  const resetsTxt = "resets " + countdown(data.codex?.primary?.resets_at);
  const r = fr.addText(resetsTxt);
  r.font = Font.systemFont(9);
  r.textColor = new Color("#888");
  fr.addSpacer();
  const u = fr.addText(ago(data.generated_at) + " ago");
  u.font = Font.systemFont(9);
  u.textColor = new Color("#888");

  return w;
}

function buildMedium(data) {
  const w = new ListWidget();
  applyBaseStyle(w);

  const topRow = w.addStack();
  const t = topRow.addText("Codex · Claude Code");
  t.font = Font.semiboldSystemFont(12);
  topRow.addSpacer();
  const plan = topRow.addText((data.codex?.plan_type || "").toUpperCase());
  plan.font = Font.systemFont(10);
  plan.textColor = new Color("#888");

  w.addSpacer(6);

  const mainRow = w.addStack();
  mainRow.layoutHorizontally();
  mainRow.centerAlignContent();

  // Left: two rings
  const leftStack = mainRow.addStack();
  leftStack.layoutHorizontally();
  const ringSize = 64;
  const r1 = leftStack.addImage(drawRing(data.codex?.primary?.used_percent, ringSize * 2, "5h"));
  r1.imageSize = new Size(ringSize, ringSize);
  leftStack.addSpacer(6);
  const r2 = leftStack.addImage(drawRing(data.codex?.secondary?.used_percent, ringSize * 2, "wk"));
  r2.imageSize = new Size(ringSize, ringSize);

  mainRow.addSpacer(12);

  // Right: Claude stats
  const rightStack = mainRow.addStack();
  rightStack.layoutVertically();
  const cTitle = rightStack.addText("Claude today");
  cTitle.font = Font.semiboldSystemFont(11);
  cTitle.textColor = new Color("#888");
  rightStack.addSpacer(2);

  const today = data.claude?.today || {};
  const totalTok = (today.input_tokens || 0) + (today.output_tokens || 0)
                 + (today.cache_creation_input_tokens || 0) + (today.cache_read_input_tokens || 0);
  const tokTxt = rightStack.addText(fmtTokens(totalTok) + " tok");
  tokTxt.font = Font.boldSystemFont(16);

  const costTxt = rightStack.addText("$" + (today.cost_usd || 0).toFixed(2) + " est");
  costTxt.font = Font.systemFont(11);
  costTxt.textColor = new Color("#888");

  rightStack.addSpacer(4);
  const msgTxt = rightStack.addText((data.claude?.messages_last_5h ?? 0) + " msgs · 5h");
  msgTxt.font = Font.systemFont(10);
  msgTxt.textColor = new Color("#888");

  w.addSpacer();

  // Footer
  const fr = w.addStack();
  const reset = "5h resets " + countdown(data.codex?.primary?.resets_at);
  const wk = "wk " + countdown(data.codex?.secondary?.resets_at);
  const ft = fr.addText(`${reset} · ${wk}`);
  ft.font = Font.systemFont(9);
  ft.textColor = new Color("#888");
  fr.addSpacer();
  const upd = fr.addText("updated " + ago(data.generated_at) + " ago");
  upd.font = Font.systemFont(9);
  upd.textColor = new Color("#888");

  return w;
}

function buildLockCircular(data) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#000000", 0);
  const ring = drawRing(data.codex?.primary?.used_percent, 120, null);
  w.addImage(ring);
  return w;
}

function buildLockRectangular(data) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#000000", 0);
  const stack = w.addStack();
  stack.layoutVertically();

  const top = stack.addText(
    `5h ${pct(data.codex?.primary?.used_percent)} · wk ${pct(data.codex?.secondary?.used_percent)}`
  );
  top.font = Font.semiboldSystemFont(13);

  const bot = stack.addText(`resets ${countdown(data.codex?.primary?.resets_at)} · ${ago(data.generated_at)} ago`);
  bot.font = Font.systemFont(11);
  return w;
}

function buildLockInline(data) {
  const w = new ListWidget();
  w.addText(`Codex 5h ${pct(data.codex?.primary?.used_percent)} · wk ${pct(data.codex?.secondary?.used_percent)}`);
  return w;
}

// ---------- 6. App-mode (foreground) summary view ----------

function buildLargeForeground(data) {
  const w = new ListWidget();
  applyBaseStyle(w);
  const t = w.addText("Codex / Claude Code Usage");
  t.font = Font.boldSystemFont(16);
  w.addSpacer(8);

  const code = w.addText(JSON.stringify(data, null, 2));
  code.font = Font.regularMonospacedSystemFont(9);
  return w;
}

// ---------- 7. Main ----------

async function main() {
  let cfg, gist;
  try {
    cfg = await loadConfig();
    if (!cfg.gistId || !cfg.token) {
      const w = emptyWidget("Tap to set up\nGist ID + GitHub PAT");
      Script.setWidget(w);
      Script.complete();
      if (!config.runsInWidget) w.presentMedium();
      return;
    }
    gist = await fetchGist(cfg);
  } catch (err) {
    const w = emptyWidget("Error:\n" + (err.message || String(err)).slice(0, 120));
    Script.setWidget(w);
    if (!config.runsInWidget) w.presentMedium();
    Script.complete();
    return;
  }

  const data = mergeSnapshots(gist);
  if (data._empty) {
    const w = emptyWidget("Gist is empty — has the Mac/Windows daemon pushed yet?");
    Script.setWidget(w);
    if (!config.runsInWidget) w.presentMedium();
    Script.complete();
    return;
  }

  const family = config.widgetFamily || "large";
  let widget;
  switch (family) {
    case "small":  widget = buildSmall(data); break;
    case "medium": widget = buildMedium(data); break;
    case "large":  widget = buildMedium(data); break;
    case "accessoryCircular":    widget = buildLockCircular(data); break;
    case "accessoryRectangular": widget = buildLockRectangular(data); break;
    case "accessoryInline":      widget = buildLockInline(data); break;
    default:                     widget = buildMedium(data); break;
  }

  Script.setWidget(widget);
  if (!config.runsInWidget) {
    if (family === "small") widget.presentSmall();
    else if (family === "accessoryCircular" || family === "accessoryRectangular" || family === "accessoryInline") {
      widget.presentMedium();
    } else widget.presentMedium();
  }
  Script.complete();
}

await main();
