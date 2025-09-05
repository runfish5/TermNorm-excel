// utils/version.js
// Version information utility for TermNorm Excel Add-in

export const VersionInfo = {
  // Static version info (would be generated during build in production)
  version: "1.0.0",
  buildTime: new Date().toISOString().slice(0, 16).replace('T', ' '),
  environment: "development",
  
  // Get commit hash placeholder (in production this would be injected during build)
  getCommitHash() {
    // In a real build process, this would be replaced with actual git commit hash
    // For now, generate a short hash-like string from current timestamp
    const hash = Date.now().toString(36).slice(-7);
    return hash;
  },

  // Get formatted version string
  getVersionString() {
    return `v${this.version}`;
  },

  // Get build info string
  getBuildString() {
    return `${this.getCommitHash()} (${this.buildTime})`;
  },

  // Get environment with color coding
  getEnvironmentInfo() {
    return {
      name: this.environment,
      color: this.environment === "development" ? "#0078d7" : 
             this.environment === "staging" ? "#ff8c00" : "#5cb85c"
    };
  },

  // Get full version info object
  getFullInfo() {
    return {
      version: this.version,
      commit: this.getCommitHash(),
      buildTime: this.buildTime,
      environment: this.environment,
      buildString: this.getBuildString(),
      versionString: this.getVersionString(),
      timestamp: Date.now() // For cache verification
    };
  },

  // Log version info to console
  logToConsole() {
    const info = this.getFullInfo();
    console.group("🔧 TermNorm Version Info");
    console.log(`Version: ${info.versionString}`);
    console.log(`Build: ${info.buildString}`);
    console.log(`Environment: ${info.environment}`);
    console.log(`Runtime: ${new Date().toLocaleString()}`);
    console.groupEnd();
  }
};