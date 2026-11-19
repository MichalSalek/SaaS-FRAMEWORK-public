const path = require('node:path');
const postcss = require('postcss');
const {
  transformCssColorValue,
} = require('../../src/application/colors/css-color-expression.ts');
const {
  channelVariableName,
  legacyVariableName,
} = require('../../src/application/colors/color-space.ts');
const {
  ALL_RUNTIME_COLOR_VARIABLES,
  MODERN_COLOR_SUPPORT,
  modernVariableName,
  resolverVariableName,
} = require('../../src/application/colors/runtime-color-variables.ts');
const {
  getRegistry,
  hasModernColor,
  cssWide,
  isModernGuarded,
} = require('./color-registry.cjs');

const CHANNELS = ['r', 'g', 'b', 'a'];
const RUNTIME_MARKER = 'nf-runtime-color-variables';

function propertyFamily(property) {
  if (property.startsWith('--')) return property;
  const plain = property.replace(/^-(?:webkit|moz|ms|o)-/, '');
  for (const family of [
    'background',
    'border',
    'outline',
    'text-decoration',
    'text-emphasis',
    'column-rule',
  ]) {
    if (plain === family || plain.startsWith(`${family}-`)) return family;
  }
  return plain;
}

function appendRuntimeResolvers(root) {
  if (
    root.nodes.some(
      node => node.type === 'comment' && node.text === RUNTIME_MARKER
    )
  )
    return;
  root.append(postcss.comment({ text: RUNTIME_MARKER }));
  const modern = postcss.atRule({
    name: 'supports',
    params: MODERN_COLOR_SUPPORT,
  });
  for (const name of ALL_RUNTIME_COLOR_VARIABLES) {
    const selector = `:where([style*="${legacyVariableName(name)}:"])`;
    const rule = postcss.rule({ selector });
    rule.append(
      postcss.decl({
        prop: resolverVariableName(name),
        value: `var(${legacyVariableName(name)})`,
      })
    );
    root.append(rule);
    const current = postcss.rule({ selector });
    current.append(
      postcss.decl({
        prop: resolverVariableName(name),
        value: `var(${modernVariableName(name)})`,
      })
    );
    modern.append(current);
  }
  root.append(modern);
}

module.exports = (options = {}) => ({
  postcssPlugin: 'nailfolio-legacy-colors',
  Once(root) {
    const projectRoot = options.projectRoot ?? path.resolve(__dirname, '../..');
    const registry = getRegistry(projectRoot);
    function processUnit(unit) {
      if (isModernGuarded(unit)) return;
      const original = unit.clone();
      const declarations = [];
      const metadataBefore = new Map();
      unit.walkDecls(decl => declarations.push(decl));
      for (const decl of declarations) {
        if (!registry.needed.has(decl.prop)) continue;
        const names = new Set(
          (decl.parent.nodes ?? [])
            .filter(node => node.type === 'decl')
            .map(node => node.prop)
        );
        if (
          CHANNELS.every(key => names.has(channelVariableName(decl.prop, key)))
        )
          metadataBefore.set(decl, true);
      }
      const families = new Set();
      for (const decl of declarations) {
        if (isModernGuarded(decl)) continue;
        const wantsChannels = registry.needed.has(decl.prop);
        const modern = hasModernColor(decl.value);
        if (!modern && (!wantsChannels || metadataBefore.has(decl))) continue;
        try {
          let channels;
          if (wantsChannels && cssWide(decl.value)) {
            channels = Object.fromEntries(
              CHANNELS.map(key => [key, decl.value])
            );
          } else {
            const result = transformCssColorValue(decl.value, {
              resolveVariable: registry.resolveVariable,
              ...(wantsChannels ? { colorChannels: true } : {}),
            });
            if (wantsChannels && !result.channels)
              throw new Error(`Cannot derive color channels for ${decl.prop}`);
            if (result.changed) {
              decl.value = result.legacy;
              families.add(propertyFamily(decl.prop));
            }
            channels = result.channels;
          }
          if (channels) {
            let previous = decl;
            for (const key of CHANNELS) {
              const metadata = postcss.decl({
                prop: channelVariableName(decl.prop, key),
                value: channels[key],
                important: decl.important,
              });
              previous.after(metadata);
              previous = metadata;
            }
          }
        } catch (error) {
          throw decl.error(`Legacy color: ${error.message}`, {
            plugin: 'nailfolio-legacy-colors',
          });
        }
      }
      if (!families.size) return;
      const conditional = postcss.atRule({
        name: 'supports',
        params: MODERN_COLOR_SUPPORT,
      });
      if (
        unit.type === 'rule' &&
        original.nodes.every(
          node => node.type === 'decl' || node.type === 'comment'
        ) &&
        !original.nodes.some(
          node => node.type === 'decl' && node.prop === 'all'
        )
      ) {
        original.nodes = original.nodes.filter(
          node =>
            node.type === 'comment' || families.has(propertyFamily(node.prop))
        );
      }
      conditional.append(original);
      unit.after(conditional);
    }
    function visit(container) {
      for (const node of [...(container.nodes ?? [])]) {
        if (node.type === 'rule') processUnit(node);
        else if (node.type === 'atrule' && node.nodes) {
          if (
            node.name.toLowerCase() === 'supports' &&
            isModernGuarded({ parent: node })
          )
            continue;
          if (
            /keyframes$/i.test(node.name) ||
            node.nodes.some(child => child.type === 'decl')
          )
            processUnit(node);
          else visit(node);
        }
      }
    }
    visit(root);
    const file = root.source?.input.file;
    if (
      file &&
      path.resolve(file) ===
        path.join(path.resolve(projectRoot), 'src/UI/styles/global.css')
    )
      appendRuntimeResolvers(root);
  },
});
module.exports.postcss = true;
