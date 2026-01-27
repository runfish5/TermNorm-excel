// utils/app-utilities.js - Consolidated application utilities
import { RELEVANCE_THRESHOLDS, RELEVANCE_COLORS, UI_TIMINGS } from "../config/config.js";
import { $ } from "./dom-helpers.js";

const setText = (id, text, title) => { const el = $(id); if (el) { el.textContent = text; if (title) el.title = title; } };

export async function getCurrentWorkbookName() {
  return Excel.run(async (ctx) => { ctx.workbook.load("name"); await ctx.sync(); return ctx.workbook.name; });
}

export function getRelevanceColor(score) {
  const s = score > 1 ? score / 100 : score;
  const { EXCELLENT, GOOD, MODERATE, LOW } = RELEVANCE_THRESHOLDS;
  return s >= EXCELLENT ? RELEVANCE_COLORS.EXCELLENT : s >= GOOD ? RELEVANCE_COLORS.GOOD : s >= MODERATE ? RELEVANCE_COLORS.MODERATE : s >= LOW ? RELEVANCE_COLORS.LOW : RELEVANCE_COLORS.NONE;
}

const version = "1.0.5", commit = "927e91c", commitDate = "2026-01-27", branch = "master", repository = "runfish5/TermNorm-excel";
const buildTime = new Date().toISOString().slice(0, 16).replace("T", " ");
const projectPath = typeof __PROJECT_PATH__ !== "undefined" ? __PROJECT_PATH__ : "C:\\...\\TermNorm-excel";
const deploymentType = typeof __DEPLOYMENT_TYPE__ !== "undefined" ? __DEPLOYMENT_TYPE__ : "development";

export function getCompactVersionString() {
  const fmtDate = d => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `v${version} · ${commit} · Commit ${fmtDate(commitDate)} · Built ${buildTime}`;
}

export function initializeProjectPathDisplay() {
  const path = projectPath.replace(/\\\\/g, "\\"), configPath = path + "\\config", configFile = configPath + "\\app.config.json";
  const typeLabels = { development: "Development", iis: "IIS Server", m365: "Microsoft 365" };

  ["development", "iis", "m365"].forEach(t => { const el = $(`path-display-${t}`); if (el) el.classList.toggle("hidden", deploymentType !== t); });

  setText("deployment-type-indicator", typeLabels[deploymentType] || deploymentType);
  ["config-path-display", "config-path-display-iis"].forEach(id => setText(id, path));
  setText("config-folder-path", configPath);
  setText("config-file-path", configFile);

  const setupCopy = (id, text, msg = "✓ Copied!") => { const btn = $(id); if (btn) btn.onclick = () => { navigator.clipboard.writeText(text); const orig = btn.textContent; btn.textContent = msg; setTimeout(() => btn.textContent = orig, UI_TIMINGS.COPY_RESET_MS); }; };
  ["copy-path-btn", "copy-path-btn-iis", "copy-folder-path-btn"].forEach(id => setupCopy(id, path, "Copied! Paste in Explorer"));
  setupCopy("copy-path-btn-2", configPath);
  setupCopy("copy-config-file-path-btn", configFile);
}
