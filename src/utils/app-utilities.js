// utils/app-utilities.js
// Consolidated application utility functions

// UI Layout utilities
export function updateContentMargin() {
  const statusBar = document.querySelector(".status-bar");
  if (statusBar) {
    const statusBarHeight = statusBar.offsetHeight;
    document.documentElement.style.setProperty("--status-bar-height", `${statusBarHeight}px`);
  }
}

// Excel integration utilities
export async function getCurrentWorkbookName() {
  return await Excel.run(async (context) => {
    const wb = context.workbook;
    wb.load("name");
    await context.sync();
    return wb.name;
  });
}

// Color utilities for relevance scoring
export function getRelevanceColor(score) {
  const s = score > 1 ? score / 100 : score;
  if (s >= 0.9) return "#C6EFCE";
  if (s >= 0.8) return "#FFEB9C";
  if (s >= 0.6) return "#FFD1A9";
  if (s >= 0.2) return "#FFC7CE";
  return "#E1E1E1";
}

export const PROCESSING_COLORS = {
  PENDING: "#FFFB9D",
  ERROR: "#FFC7CE",
  CLEAR: null,
};

// Version display functionality
const version = "1.0.0";
const commit = "b4abbea";
const commitDate = "2025-10-06 15:12";
const branch = "master";
const repository = "runfish5/excel-entity-standardizer";
const buildTime = new Date().toISOString().slice(0, 16).replace("T", " ");

export function initializeVersionDisplay() {
  const versionEl = document.getElementById("version-number");
  if (versionEl) versionEl.textContent = `v${version}`;

  const buildEl = document.getElementById("version-build");
  if (buildEl) {
    buildEl.textContent = `${commit} (${commitDate})`;
    buildEl.title = `Branch: ${branch}\nRepository: ${repository}`;
  }

  const runtimeEl = document.getElementById("version-runtime");
  if (runtimeEl) runtimeEl.textContent = buildTime;

  const bundleEl = document.getElementById("version-bundle-size");
  if (bundleEl) bundleEl.textContent = "N/A";
}
