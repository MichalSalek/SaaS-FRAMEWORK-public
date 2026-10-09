// Workaround: tsx transforms .json files into JS modules in ESM packages.
// This preload restores native JSON require() behavior before tsx hooks run.
const fs = require('fs');
const Module = require('module');

const originalJsonLoader = Module._extensions['.json'];
Module._extensions['.json'] = function(module, filename) {
  if (originalJsonLoader) {
    try {
      return originalJsonLoader(module, filename);
    } catch {
      // If the original loader fails (tsx transformed it), parse manually
    }
  }
  const content = fs.readFileSync(filename, 'utf8');
  module.exports = JSON.parse(content);
};
