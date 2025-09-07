export const VersionInfo = {
  version: "1.0.0",
  commit: "26f40cb",
  commitDate: "2025-09-06 20:20",
  branch: "web365debug_dragnDrop",
  repository: "runfish5/excel-entity-standardizer",
  buildTime: new Date().toISOString().slice(0, 16).replace('T', ' '),

  getVersionString() {
    return `v${this.version}`;
  },

  getGitInfo() {
    return `${this.commit} (${this.commitDate})`;
  },

  initializeDisplay() {
    console.log(`TermNorm ${this.getVersionString()} - ${this.getGitInfo()}`);
    
    const versionEl = document.getElementById("version-number");
    if (versionEl) versionEl.textContent = this.getVersionString();
    
    const buildEl = document.getElementById("version-build");
    if (buildEl) {
      buildEl.textContent = this.getGitInfo();
      buildEl.title = `Branch: ${this.branch}\nRepository: ${this.repository}`;
    }
    
    const runtimeEl = document.getElementById("version-runtime");
    if (runtimeEl) runtimeEl.textContent = this.buildTime;
    
    const bundleEl = document.getElementById("version-bundle-size");
    if (bundleEl) bundleEl.textContent = "N/A";
  },
};
