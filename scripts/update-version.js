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
  
  console.log('Updating version.js with git info:', gitInfo);
  
  // Read current version file
  let versionContent = fs.readFileSync(versionPath, 'utf8');
  
  // Replace git information
  versionContent = versionContent
    .replace(/commit: "[^"]*"/, `commit: "${gitInfo.commit}"`)
    .replace(/commitDate: "[^"]*"/, `commitDate: "${gitInfo.commitDate}"`)
    .replace(/branch: "[^"]*"/, `branch: "${gitInfo.branch}"`)
    .replace(/repository: "[^"]*"/, `repository: "${gitInfo.repository}"`);
  
  // Write updated content
  fs.writeFileSync(versionPath, versionContent, 'utf8');
  
  console.log('✅ Version file updated successfully');
}

if (require.main === module) {
  updateVersionFile();
}

module.exports = { getGitInfo, updateVersionFile };