#!/usr/bin/env node
// scripts/update-version.js
// Updates version.js with current git information

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getGitInfo() {
  try {
    // Get commit hash (short), date, and subject
    const commitInfo = execSync('git log -1 --format="%h|%cd|%s" --date=format:"%Y-%m-%d %H:%M"', { encoding: 'utf8' }).trim();
    const [commit, commitDate] = commitInfo.split('|');
    
    // Get current branch
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    
    // Get repository from remote URL
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    const repository = remoteUrl
      .replace(/^https:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/^git@github\.com:/, '');
    
    return {
      commit,
      commitDate,
      branch,
      repository
    };
  } catch (error) {
    console.warn('Could not get git information:', error.message);
    return {
      commit: 'unknown',
      commitDate: new Date().toISOString().slice(0, 16).replace('T', ' '),
      branch: 'unknown',
      repository: 'unknown/unknown'
    };
  }
}

function updateVersionFile() {
  const gitInfo = getGitInfo();
  const versionPath = path.join(__dirname, '..', 'src', 'utils', 'version.js');
  
  // Generate build timestamp
  const buildTime = new Date()
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
  const fullBuildTime = `${buildTime} UTC+${offsetHours}`;
  
  console.log('Updating version.js with git info:', gitInfo);
  console.log('Build timestamp:', fullBuildTime);
  
  // Read current version file
  let versionContent = fs.readFileSync(versionPath, 'utf8');
  
  // Replace git information and build time
  versionContent = versionContent
    .replace(/commit: "[^"]*"/, `commit: "${gitInfo.commit}"`)
    .replace(/commitDate: "[^"]*"/, `commitDate: "${gitInfo.commitDate}"`)
    .replace(/branch: "[^"]*"/, `branch: "${gitInfo.branch}"`)
    .replace(/repository: "[^"]*"/, `repository: "${gitInfo.repository}"`)
    .replace(/buildTime: "[^"]*"/, `buildTime: "${fullBuildTime}"`);
  
  // Write updated content
  fs.writeFileSync(versionPath, versionContent, 'utf8');
  
  console.log('✅ Version file updated successfully');
}

if (require.main === module) {
  updateVersionFile();
}

module.exports = { getGitInfo, updateVersionFile };