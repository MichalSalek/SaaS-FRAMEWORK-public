const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');
const {
  parseColorLiteral,
  variableChannels,
} = require('../../src/application/colors/color-space.ts');
const {
  RUNTIME_COLOR_VARIABLES,
  MODERN_COLOR_SUPPORT,
} = require('../../src/application/colors/runtime-color-variables.ts');

const cache = new Map();
const normalize = value => value.replace(/\s+/g, '').toLowerCase();
const protectedConditions = new Set([
  normalize(MODERN_COLOR_SUPPORT),
  normalize('(color: color(from currentColor srgb r g b))'),
]);

function isModernGuarded(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      parent.type === 'atrule' &&
      parent.name.toLowerCase() === 'supports' &&
      protectedConditions.has(normalize(parent.params))
    )
      return true;
  }
  return false;
}

const hasModernColor = value =>
  /(?:color-mix|oklch|oklab|lab|lch|color)\s*\(|(?:rgba?|hsla?)\(\s*from\b/i.test(
    value
  );
const cssWide = value =>
  ['inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(
    value.trim().toLowerCase()
  );

function cssFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.css')) files.push(file);
    }
  }
  const directory = path.join(root, 'src/UI');
  if (!fs.existsSync(directory))
    throw new Error(`Missing UI color source root: ${directory}`);
  walk(directory);
  if (!files.length)
    throw new Error('No UI CSS files found for legacy color compilation');
  return files.sort();
}

function variableReferences(value) {
  const names = new Set();
  valueParser(value).walk(node => {
    if (node.type !== 'function' || node.value.toLowerCase() !== 'var') return;
    const first = node.nodes.find(
      child => child.type !== 'space' && child.type !== 'comment'
    );
    if (first?.type === 'word' && first.value.startsWith('--'))
      names.add(first.value);
  });
  return names;
}

function mixReferences(value) {
  const names = new Set();
  valueParser(value).walk(node => {
    if (node.type === 'function' && node.value.toLowerCase() === 'color-mix') {
      for (const name of variableReferences(valueParser.stringify(node.nodes)))
        names.add(name);
      return false;
    }
  });
  return names;
}

function potentialColor(value) {
  return (
    !!parseColorLiteral(value) || /^(?:var|color-mix)\s*\(/i.test(value.trim())
  );
}

function getRegistry(root) {
  root = fs.realpathSync(root);
  const files = cssFiles(root);
  const signature = files
    .map(file => {
      const stat = fs.statSync(file);
      return `${file}:${stat.size}:${stat.mtimeMs}`;
    })
    .join('\n');
  const existing = cache.get(root);
  if (existing?.signature === signature) return existing.registry;
  const definitions = new Set(RUNTIME_COLOR_VARIABLES);
  const needed = new Set(RUNTIME_COLOR_VARIABLES);
  const declarations = [];
  for (const file of files) {
    postcss
      .parse(fs.readFileSync(file, 'utf8'), { from: file })
      .walkDecls(decl => {
        if (decl.prop.startsWith('--')) definitions.add(decl.prop);
        if (isModernGuarded(decl)) return;
        declarations.push(decl);
        if (decl.prop.startsWith('--color-') && potentialColor(decl.value))
          needed.add(decl.prop);
        for (const name of mixReferences(decl.value)) needed.add(name);
      });
  }
  let previous = -1;
  while (previous !== needed.size) {
    previous = needed.size;
    for (const decl of declarations) {
      if (!needed.has(decl.prop)) continue;
      for (const name of variableReferences(decl.value)) needed.add(name);
    }
  }
  const registry = {
    definitions,
    needed,
    files: files.length,
    resolveVariable(name, fallback) {
      if (!definitions.has(name) && !fallback)
        throw new Error(`No source or runtime channels declared for ${name}`);
      return variableChannels(name, fallback);
    },
  };
  cache.set(root, { signature, registry });
  return registry;
}

module.exports = { getRegistry, hasModernColor, cssWide, isModernGuarded };
