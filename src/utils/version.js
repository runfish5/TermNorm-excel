// utils/version.js
// Version information utility for TermNorm Excel Add-in

export const VersionInfo = {
  // Static version info (would be generated during build in production)
  version: "1.0.0",
  buildTime: (() => {
    const zurichTime = new Date().toLocaleString('de-CH', { 
      timeZone: 'Europe/Zurich',
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).replace(/(\d{2})\.(\d{2})\.(\d{4}), (\d{2}:\d{2})/, '$3-$2-$1 $4');
    
    // Determine if we're in CET (UTC+1) or CEST (UTC+2)
    const now = new Date();
    const zurichDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offsetHours = Math.round((zurichDate.getTime() - utcDate.getTime()) / (1000 * 60 * 60));
    
    return `${zurichTime} UTC+${offsetHours}`;
  })(),
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