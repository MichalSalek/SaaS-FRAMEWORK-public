// Keep Next's defaults: a custom PostCSS config replaces its built-in plugins.
// Only the compatibility branch uses sRGB; capable engines keep authored colors.
const path = require('node:path');

module.exports = {
  plugins: {
    // Next runs PostCSS from the frontend directory. Turbopack rewrites
    // require.resolve()/__dirname to virtual paths that native require cannot load.
    [path.resolve(process.cwd(), 'scripts/colors/postcss-legacy-colors.cjs')]: {},
    'next/dist/compiled/postcss-flexbugs-fixes': {},
    'next/dist/compiled/postcss-preset-env': {
      browsers: require('next/dist/shared/lib/modern-browserslist-target'),
      autoprefixer: { flexbox: 'no-2009' },
      stage: 3,
      features: { 'custom-properties': false },
    },
  },
};
