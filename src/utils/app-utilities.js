// utils/app-utilities.js - Consolidated application utilities

export function updateContentMargin() {
  const statusBar = document.querySelector(".status-bar");
  if (statusBar) document.documentElement.style.setProperty("--status-bar-height", `${statusBar.offsetHeight}px`);
}

export async function getCurrentWorkbookName() {
  return Excel.run(async (ctx) => { ctx.workbook.load("name"); await ctx.sync(); return ctx.workbook.name; });
}

export function getRelevanceColor(score) {
  const s = score > 1 ? score / 100 : score;
  if (s >= 0.9) return "#C6EFCE";
  if (s >= 0.8) return "#FFEB9C";
  if (s >= 0.6) return "#FFD1A9";
  if (s >= 0.2) return "#FFC7CE";
  return "#E1E1E1";
}

export const PROCESSING_COLORS = { PENDING: "#FFFB9D", ERROR: "#FFC7CE", CLEAR: null };

const version = "1.0.2", commit = "ab11d3a", commitDate = "2025-11-27 18:56", branch = "master", repository = "runfish5/TermNorm-excel";
const buildTime = new Date().toISOString().slice(0, 16).replace("T", " ");
const projectPath = typeof __PROJECT_PATH__ !== "undefined" ? __PROJECT_PATH__ : "C:\\...\\TermNorm-excel";
const deploymentType = typeof __DEPLOYMENT_TYPE__ !== "undefined" ? __DEPLOYMENT_TYPE__ : "development";

export function initializeVersionDisplay() {
  const set = (id, text, title) => { const el = document.getElementById(id); if (el) { el.textContent = text; if (title) el.title = title; } };
  set("version-number", `v${version}`);
  set("version-build", `${commit} (${commitDate})`, `Branch: ${branch}\nRepository: ${repository}`);
  set("version-runtime", buildTime);
  set("version-bundle-size", "N/A");
}

export function initializeProjectPathDisplay() {
  const normalizedPath = projectPath.replace(/\\\\/g, "\\");
  const configPath = normalizedPath + "\\config";
  const configFilePath = configPath + "\\app.config.json";

  const typeLabels = { development: "Development", iis: "IIS Server", m365: "Microsoft 365" };
  ["development", "iis", "m365"].forEach(t => {
    const el = document.getElementById(`path-display-${t}`);
    if (el) el.style.display = deploymentType === t ? "block" : "none";
  });

  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("deployment-type-indicator", typeLabels[deploymentType] || deploymentType);
  set("config-path-display", normalizedPath);
  set("config-path-display-iis", normalizedPath);
  set("config-folder-path", configPath);
  set("config-file-path", configFilePath);

  const setupCopy = (id, text) => {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = () => { navigator.clipboard.writeText(text); const orig = btn.textContent; btn.textContent = "✓"; setTimeout(() => btn.textContent = orig, 1500); };
  };
  setupCopy("copy-path-btn", normalizedPath);
  setupCopy("copy-path-btn-iis", normalizedPath);
  setupCopy("copy-path-btn-2", configPath);
  setupCopy("copy-config-file-path-btn", configFilePath);
}
