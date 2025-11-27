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
const version = "1.0.2";
const commit = "ab11d3a";
const commitDate = "2025-11-27 18:56";
const branch = "master";
const repository = "runfish5/TermNorm-excel";
const buildTime = new Date().toISOString().slice(0, 16).replace("T", " ");
const projectPath = typeof __PROJECT_PATH__ !== "undefined" ? __PROJECT_PATH__ : "C:\\...\\TermNorm-excel";
const deploymentType = typeof __DEPLOYMENT_TYPE__ !== "undefined" ? __DEPLOYMENT_TYPE__ : "development";

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
  // Normalize path (double backslashes to single for display)
  const normalizedPath = projectPath.replace(/\\\\/g, "\\");
  const configPath = normalizedPath + "\\config";
  const configFilePath = configPath + "\\app.config.json";

  // Show/hide deployment-specific sections
  const devSection = document.getElementById("path-display-development");
  const iisSection = document.getElementById("path-display-iis");
  const m365Section = document.getElementById("path-display-m365");

  if (devSection) devSection.style.display = deploymentType === "development" ? "block" : "none";
  if (iisSection) iisSection.style.display = deploymentType === "iis" ? "block" : "none";
  if (m365Section) m365Section.style.display = deploymentType === "m365" ? "block" : "none";

  // Update deployment type indicator
  const deploymentTypeEl = document.getElementById("deployment-type-indicator");
  if (deploymentTypeEl) {
    const typeLabels = {
      development: "Development",
      iis: "IIS Server",
      m365: "Microsoft 365",
    };
    deploymentTypeEl.textContent = typeLabels[deploymentType] || deploymentType;
  }

  // Display paths (used across all deployment types for filesystem access scenarios)
  const pathEl = document.getElementById("config-path-display");
  if (pathEl) pathEl.textContent = normalizedPath;

  // IIS-specific path display
  const pathElIIS = document.getElementById("config-path-display-iis");
  if (pathElIIS) pathElIIS.textContent = normalizedPath;

  const configPathEl = document.getElementById("config-folder-path");
  if (configPathEl) configPathEl.textContent = configPath;

  const configFilePathEl = document.getElementById("config-file-path");
  if (configFilePathEl) configFilePathEl.textContent = configFilePath;

  // Setup copy buttons
  setupCopyButton("copy-path-btn", normalizedPath);
  setupCopyButton("copy-path-btn-iis", normalizedPath);
  setupCopyButton("copy-path-btn-2", configPath);
  setupCopyButton("copy-config-file-path-btn", configFilePath);
}

// Helper function for copy button setup
function setupCopyButton(buttonId, textToCopy) {
  const btn = document.getElementById(buttonId);
  if (btn) {
    btn.onclick = () => {
      navigator.clipboard.writeText(textToCopy);
      const originalText = btn.textContent;
      btn.textContent = "✓";
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1500);
    };
  }
}
