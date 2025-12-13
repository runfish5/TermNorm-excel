// utils/app-utilities.js - Consolidated application utilities
import { RELEVANCE_THRESHOLDS, RELEVANCE_COLORS, PROCESSING_COLORS } from "../config/normalization.config.js";
import { $ } from "./dom-helpers.js";

export { PROCESSING_COLORS };
const setText = (id, text, title) => { const el = $(id); if (el) { el.textContent = text; if (title) el.title = title; } };

export async function getCurrentWorkbookName() {
  return Excel.run(async (ctx) => { ctx.workbook.load("name"); await ctx.sync(); return ctx.workbook.name; });
}

export function getRelevanceColor(score) {
  const s = score > 1 ? score / 100 : score;
  const { EXCELLENT, GOOD, MODERATE, LOW } = RELEVANCE_THRESHOLDS;
  return s >= EXCELLENT ? RELEVANCE_COLORS.EXCELLENT : s >= GOOD ? RELEVANCE_COLORS.GOOD : s >= MODERATE ? RELEVANCE_COLORS.MODERATE : s >= LOW ? RELEVANCE_COLORS.LOW : RELEVANCE_COLORS.NONE;
}

const version = "1.0.3", commit = "66cd6d2", commitDate = "2025-12-08", branch = "master", repository = "runfish5/TermNorm-excel";
const buildTime = new Date().toISOString().slice(0, 16).replace("T", " ");
const projectPath = typeof __PROJECT_PATH__ !== "undefined" ? __PROJECT_PATH__ : "C:\\...\\TermNorm-excel";
const deploymentType = typeof __DEPLOYMENT_TYPE__ !== "undefined" ? __DEPLOYMENT_TYPE__ : "development";

export function initializeVersionDisplay() {
  setText("version-number", `v${version}`);
  setText("version-build", `${commit} (${commitDate})`, `Branch: ${branch}\nRepository: ${repository}`);
  setText("version-runtime", buildTime);
  setText("version-bundle-size", "N/A");
}

export function getCompactVersionString() {
  const fmtDate = d => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `v${version} · ${commit} · Commit ${fmtDate(commitDate)} · Built ${buildTime}`;
}

export function initializeProjectPathDisplay() {
  const path = projectPath.replace(/\\\\/g, "\\"), configPath = path + "\\config", configFile = configPath + "\\app.config.json";
  const typeLabels = { development: "Development", iis: "IIS Server", m365: "Microsoft 365" };

  ["development", "iis", "m365"].forEach(t => { const el = $(`path-display-${t}`); if (el) el.style.display = deploymentType === t ? "block" : "none"; });

  setText("deployment-type-indicator", typeLabels[deploymentType] || deploymentType);
  ["config-path-display", "config-path-display-iis"].forEach(id => setText(id, path));
  setText("config-folder-path", configPath);
  setText("config-file-path", configFile);

  const setupCopy = (id, text) => { const btn = $(id); if (btn) btn.onclick = () => { navigator.clipboard.writeText(text); const orig = btn.textContent; btn.textContent = "✓"; setTimeout(() => btn.textContent = orig, 1500); }; };
  ["copy-path-btn", "copy-path-btn-iis"].forEach(id => setupCopy(id, path));
  setupCopy("copy-path-btn-2", configPath);
  setupCopy("copy-config-file-path-btn", configFile);
}
