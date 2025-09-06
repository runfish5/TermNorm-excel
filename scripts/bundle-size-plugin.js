// webpack plugin to inject bundle size into version.js after build
const fs = require('fs');
const path = require('path');

class BundleSizePlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('BundleSizePlugin', (compilation) => {
      // Find the main taskpane bundle
      const taskpaneAsset = compilation.assets['taskpane.js'];
      if (!taskpaneAsset) return;

      const bundleSize = taskpaneAsset.size();
      const formattedSize = this.formatBytes(bundleSize);
      
      console.log(`Bundle size: ${formattedSize}`);
      
      // Update version.js with bundle size
      const versionPath = path.join(__dirname, '..', 'src', 'utils', 'version.js');
      
      try {
        let versionContent = fs.readFileSync(versionPath, 'utf8');
        
        // Try multiple patterns to catch different bundle size formats
        const patterns = [
          /bundleSize:\s*"[^"]*"/,                    // bundleSize: "anything"
          /bundleSize:\s*'[^']*'/,                    // bundleSize: 'anything'
          /bundleSize:\s*`[^`]*`/,                    // bundleSize: `anything`
          /bundleSize:\s*__BUNDLE_SIZE_PLACEHOLDER__/ // bundleSize: __BUNDLE_SIZE_PLACEHOLDER__
        ];
        
        let updated = false;
        for (const pattern of patterns) {
          if (pattern.test(versionContent)) {
            versionContent = versionContent.replace(pattern, `bundleSize: "${formattedSize}"`);
            updated = true;
            break;
          }
        }
        
        if (!updated) {
          console.warn('No bundleSize pattern found in version.js. Searching for bundleSize line...');
          const lines = versionContent.split('\n');
          const bundleLine = lines.find(line => line.includes('bundleSize'));
          console.log('Bundle size line found:', bundleLine);
          console.log('Full content preview:');
          console.log(versionContent.substring(0, 800));
          return;
        }
        
        fs.writeFileSync(versionPath, versionContent, 'utf8');
        console.log(`✅ Bundle size (${formattedSize}) injected into version.js`);
      } catch (error) {
        console.warn('Could not update bundle size in version.js:', error.message);
      }
    });
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KiB', 'MiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i];
  }
}

module.exports = BundleSizePlugin;