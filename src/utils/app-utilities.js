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
const commit = "72bb152";
const commitDate = "2025-10-07 14:43";
const branch = "master";
const repository = "runfish5/excel-entity-standardizer";
const buildTime = new Date().toISOString().slice(0, 16).replace("T", " ");
const projectPath = typeof __PROJECT_PATH__ !== "undefined" ? __PROJECT_PATH__ : "C:\\...\\TermNorm-excel";

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

export function initializeProjectPathDisplay() {
  const pathEl = document.getElementById("config-path-display");
  // Display path with single backslashes for readability
  if (pathEl) pathEl.textContent = projectPath.replace(/\\\\/g, "\\");

  // Display config folder path (for Advanced section in Step 1)
  const configPathEl = document.getElementById("config-folder-path");
  const configPath = projectPath.replace(/\\\\/g, "\\") + "\\config";
  if (configPathEl) configPathEl.textContent = configPath;

  // Display config file path (for Manual Configuration in Step 2)
  const configFilePathEl = document.getElementById("config-file-path");
  const configFilePath = configPath + "\\app.config.json";
  if (configFilePathEl) configFilePathEl.textContent = configFilePath;

  // Setup copy button for main path
  const copyBtn1 = document.getElementById("copy-path-btn");
  if (copyBtn1) {
    copyBtn1.onclick = () => {
      navigator.clipboard.writeText(projectPath.replace(/\\\\/g, "\\"));
      const originalText = copyBtn1.textContent;
      copyBtn1.textContent = "✓";
      setTimeout(() => {
        copyBtn1.textContent = originalText;
      }, 1500);
    };
  }

  // Setup copy button for config folder path
  const copyBtn2 = document.getElementById("copy-path-btn-2");
  if (copyBtn2) {
    copyBtn2.onclick = () => {
      navigator.clipboard.writeText(configPath);
      const originalText = copyBtn2.textContent;
      copyBtn2.textContent = "✓";
      setTimeout(() => {
        copyBtn2.textContent = originalText;
      }, 1500);
    };
  }

  // Setup copy button for config file path
  const copyBtn3 = document.getElementById("copy-config-file-path-btn");
  if (copyBtn3) {
    copyBtn3.onclick = () => {
      navigator.clipboard.writeText(configFilePath);
      const originalText = copyBtn3.textContent;
      copyBtn3.textContent = "✓";
      setTimeout(() => {
        copyBtn3.textContent = originalText;
      }, 1500);
    };
  }
}
