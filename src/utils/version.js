// Version constants
const version = "1.0.0";
const commit = "26f40cb";
const commitDate = "2025-09-06 20:20";
const branch = "web365debug_dragnDrop";
const repository = "runfish5/excel-entity-standardizer";
const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

// Initialize version display in UI
export function initializeVersionDisplay() {
  console.log(`TermNorm v${version} - ${commit} (${commitDate})`);
  
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
