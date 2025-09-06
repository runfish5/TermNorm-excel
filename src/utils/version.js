// utils/version.js
// Version information utility for TermNorm Excel Add-in

export const VersionInfo = {
  version: "1.0.0",
  commit: "26f40cb", // Auto-updated by scripts/update-version.js
  commitDate: "2025-09-06 20:20", // Auto-updated by scripts/update-version.js
  branch: "web365debug_dragnDrop", // Auto-updated by scripts/update-version.js
  repository: "runfish5/excel-entity-standardizer", // Auto-updated by scripts/update-version.js
  buildTime: (() => {
    const zurichTime = new Date()
      .toLocaleString("de-CH", {
        timeZone: "Europe/Zurich",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      .replace(/(\d{2})\.(\d{2})\.(\d{4}), (\d{2}:\d{2})/, "$3-$2-$1 $4");

    const now = new Date();
    const zurichDate = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Zurich" }));
    const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const offsetHours = Math.round((zurichDate.getTime() - utcDate.getTime()) / (1000 * 60 * 60));

    return `${zurichTime} UTC+${offsetHours}`;
  })(),

  // Get formatted version string
  getVersionString() {
    return `v${this.version}`;
  },

  // Get git info string for security/debugging
  getGitInfo() {
    return `${this.commit} (${this.commitDate})`;
  },

  // Get repository info for security verification
  getRepositoryInfo() {
    return {
      name: this.repository,
      url: `https://github.com/${this.repository}`,
      commitUrl: `https://github.com/${this.repository}/commit/${this.commit}`,
    };
  },

  // Get essential info for debugging and security
  getEssentialInfo() {
    return {
      version: this.version,
      commit: this.commit,
      commitDate: this.commitDate,
      branch: this.branch,
      repository: this.repository,
      buildTime: this.buildTime,
      timestamp: Date.now(), // For cache verification
    };
  },

  // Log essential info to console
  logToConsole() {
    const repo = this.getRepositoryInfo();
    console.group("🔧 TermNorm Version Info");
    console.log(`Version: ${this.getVersionString()}`);
    console.log(`Commit: ${this.commit} (${this.commitDate}) on ${this.branch}`);
    console.log(`Repository: ${this.repository}`);
    console.log(`Build Time: ${this.buildTime}`);
    console.log(`Commit URL: ${repo.commitUrl}`);
    console.groupEnd();
  },

  // Initialize version display in DOM
  initializeDisplay() {
    this.logToConsole();
    const info = this.getEssentialInfo(), repo = this.getRepositoryInfo();
    document.getElementById("version-number") && (document.getElementById("version-number").textContent = this.getVersionString());
    const buildEl = document.getElementById("version-build"); buildEl && (buildEl.textContent = this.getGitInfo(), buildEl.title = `Repository: ${info.repository}\nCommit: ${repo.commitUrl}\nCommit Date: ${info.commitDate}\nBranch: ${info.branch}\nBuild Time: ${info.buildTime}`);
    const runtimeEl = document.getElementById("version-runtime"); runtimeEl && (runtimeEl.textContent = info.buildTime, runtimeEl.title = `Cache verification: ${info.timestamp}\nRepository: ${repo.url}`);
    const bundleEl = document.getElementById("version-bundle-size"); bundleEl && (bundleEl.textContent = "N/A", bundleEl.title = "Webpack bundle size for taskpane.js\nGenerated during build process");
  },
};
