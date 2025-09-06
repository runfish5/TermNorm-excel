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
        versionContent = versionContent.replace(
          /bundleSize: "[^"]*"/,
          `bundleSize: "${formattedSize}"`
        );
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