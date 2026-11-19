import { afterEach, describe, expect, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import { createRequire } from 'node:module';
import postcss from 'postcss';
const projectRoot = process.cwd();
const require = createRequire(path.join(projectRoot, 'package.json'));
const plugin = require('./scripts/colors/postcss-legacy-colors.cjs');
const {
  MODERN_COLOR_SUPPORT,
  RUNTIME_COLOR_VARIABLES,
  legacyVariableName,
  resolverVariableName,
} = (() => {
  const runtime = require('./src/application/colors/runtime-color-variables.ts');
  return {
    ...runtime,
    legacyVariableName: require('./src/application/colors/color-space.ts')
      .legacyVariableName,
  };
})();

const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function project(css, relative = 'src/UI/styles/global.css') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-colors-postcss-'));
  temporaryRoots.push(root);
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, css);
  return { root, file };
}
async function transform(css, root, file) {
  return (
    await postcss([plugin({ projectRoot: root })]).process(css, { from: file })
  ).css;
}
function declarations(rule) {
  return (rule.nodes ?? [])
    .filter(node => node.type === 'decl')
    .map(node => [node.prop, node.value, node.important]);
}

describe('legacy CSS compatibility', () => {
  it('Next CSS optimizer preserves guarded modern values and the legacy cascade', async () => {
    const css = `
      :root { --color-a: oklch(.6 .1 20); }
      .surface {
        background-color: #111;
        background: color-mix(in oklch, var(--color-a) 40%, transparent);
        background-color: #333 !important;
      }
      .gradient {
        background-image: linear-gradient(color-mix(in oklch, var(--color-a), transparent), oklch(.7 .1 20));
      }
      @supports (display: grid) {
        .nested { color: color-mix(in oklch, var(--color-a), white); }
      }
      @keyframes fade {
        from { color: color-mix(in oklch, var(--color-a), transparent); }
        to { color: oklch(.8 .1 20); }
      }
    `;
    const fixture = project(css, 'src/UI/components/example.css');
    const compiled = await transform(css, fixture.root, fixture.file);
    const {
      CssMinimizerPlugin,
    } = require('next/dist/build/webpack/plugins/css-minimizer-plugin');
    const { sources } = require('next/dist/compiled/webpack/webpack');
    const optimized = await new CssMinimizerPlugin({}).optimizeAsset(
      'fixture.css',
      new sources.RawSource(compiled)
    );
    const result = postcss.parse(optimized.source().toString());
    const normalized = value => value.replace(/\s+/g, '');
    const guarded = node => {
      for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
        if (
          ancestor.type === 'atrule' &&
          ancestor.name === 'supports' &&
          normalized(ancestor.params) === normalized(MODERN_COLOR_SUPPORT)
        ) {
          return true;
        }
      }
      return false;
    };
    const declarationsBySelector = (selector, modern) => {
      const matches = [];
      result.walkRules(selector, rule => {
        if (guarded(rule) === modern) matches.push(...declarations(rule));
      });
      return matches;
    };

    let modernDeclarations = 0;
    result.walkDecls(decl => {
      if (
        !decl.prop.startsWith('--') &&
        /(?:oklch|color-mix)\(/i.test(decl.value)
      ) {
        modernDeclarations++;
        assert.ok(guarded(decl), `unguarded modern value in ${decl.prop}`);
      }
    });
    assert.ok(modernDeclarations >= 5);

    const root = declarationsBySelector(':root', false);
    assert.match(root.find(([name]) => name === '--color-a')[1], /^rgba\(/);
    const base = declarationsBySelector('.surface', false);
    assert.match(base.find(([name]) => name === 'background')[1], /^rgba\(/);
    assert.deepEqual(
      base.map(([name]) => name),
      ['background-color', 'background', 'background-color']
    );
    assert.equal(base.at(-1)[2], true);
    const modern = declarationsBySelector('.surface', true);
    assert.match(
      modern.find(([name]) => name === 'background')[1],
      /color-mix\(/
    );
    assert.deepEqual(
      modern.map(([name]) => name),
      ['background-color', 'background', 'background-color']
    );
    assert.equal(modern.at(-1)[2], true);
    assert.match(
      declarationsBySelector('.gradient', false).find(
        ([name]) => name === 'background-image'
      )[1],
      /linear-gradient\(rgba\(/
    );
    assert.match(
      declarationsBySelector('.gradient', true).find(
        ([name]) => name === 'background-image'
      )[1],
      /linear-gradient\(color-mix\(/
    );
    const nested = [];
    result.walkRules('.nested', rule => nested.push(rule));
    assert.ok(nested.some(rule => !guarded(rule)));
    assert.ok(nested.some(rule => guarded(rule)));
    assert.ok(
      nested.every(rule => {
        for (let ancestor = rule.parent; ancestor; ancestor = ancestor.parent) {
          if (
            ancestor.type === 'atrule' &&
            ancestor.name === 'supports' &&
            normalized(ancestor.params) === '(display:grid)'
          )
            return true;
        }
        return false;
      })
    );
    const keyframes = [];
    result.walkAtRules('keyframes', rule => {
      if (rule.params === 'fade') keyframes.push(rule);
    });
    assert.ok(
      keyframes.some(
        rule => !guarded(rule) && rule.toString().includes('rgba(')
      )
    );
    assert.ok(
      keyframes.some(
        rule => guarded(rule) && rule.toString().includes('color-mix(')
      )
    );
  });

  it('aliases and rebindings get per-scope color channel metadata', async () => {
    const css =
      ':root { --color-base: oklch(.6 .15 20); --color-alias: var(--color-base); } .card { --color-base: #000; color: color-mix(in srgb, var(--color-alias) 40%, transparent); }';
    const f = project(css, 'src/UI/components/example.css');
    const out = postcss.parse(await transform(css, f.root, f.file));
    const root = out.nodes.find(
      n => n.type === 'rule' && n.selector === ':root'
    );
    const card = out.nodes.find(
      n => n.type === 'rule' && n.selector === '.card'
    );
    const rootNames = declarations(root).map(([prop]) => prop);
    const cardNames = declarations(card).map(([prop]) => prop);
    for (const channel of ['r', 'g', 'b', 'a']) {
      assert.ok(rootNames.includes(`--nf-c-color-base-${channel}`));
      assert.ok(rootNames.includes(`--nf-c-color-alias-${channel}`));
      assert.ok(cardNames.includes(`--nf-c-color-base-${channel}`));
    }
    assert.match(
      declarations(card).find(([prop]) => prop === 'color')[1],
      /^rgba\(/
    );
    const rootAlias = declarations(root).find(
      ([prop]) => prop === '--nf-c-color-alias-r'
    )[1];
    assert.match(rootAlias, /var\(--nf-c-color-base-r\)/);
  });

  it('modern guarded shorthand and longhand retain the original cascade order', async () => {
    const css =
      '.box { background-color: #111; background: color-mix(in srgb, #fff 25%, transparent); background-color: #222 !important; color: #333; }';
    const f = project(css, 'src/UI/components/example.css');
    const out = postcss.parse(await transform(css, f.root, f.file));
    const base = out.nodes.find(
      n => n.type === 'rule' && n.selector === '.box'
    );
    const support = out.nodes.find(
      n => n.type === 'atrule' && n.name === 'supports'
    );
    const modern = support.nodes.find(
      n => n.type === 'rule' && n.selector === '.box'
    );
    assert.deepEqual(
      declarations(base).map(([p]) => p),
      ['background-color', 'background', 'background-color', 'color']
    );
    assert.deepEqual(declarations(modern), [
      ['background-color', '#111', undefined],
      ['background', 'color-mix(in srgb, #fff 25%, transparent)', undefined],
      ['background-color', '#222', true],
    ]);
    assert.equal(support.params, MODERN_COLOR_SUPPORT);
  });

  it('media, supports and keyframes keep their condition and original modern rules', async () => {
    const css =
      '@media (min-width: 600px) { .x { color: oklch(.5 .1 30); } } @supports (display: grid) { .y { border-color: color-mix(in srgb, black, white); } } @keyframes fade { from { color: oklch(.4 .1 30); } to { color: oklch(.8 .1 30); } }';
    const f = project(css, 'src/UI/components/example.css');
    const out = postcss.parse(await transform(css, f.root, f.file));
    const media = out.nodes.find(
      n => n.type === 'atrule' && n.name === 'media'
    );
    assert.ok(
      media.nodes.some(
        n =>
          n.type === 'atrule' &&
          n.name === 'supports' &&
          n.params === MODERN_COLOR_SUPPORT
      )
    );
    const grid = out.nodes.find(
      n =>
        n.type === 'atrule' &&
        n.name === 'supports' &&
        n.params === '(display: grid)'
    );
    assert.ok(
      grid.nodes.some(
        n =>
          n.type === 'atrule' &&
          n.name === 'supports' &&
          n.params === MODERN_COLOR_SUPPORT
      )
    );
    const frames = out.nodes.find(
      n => n.type === 'atrule' && n.name === 'keyframes'
    );
    assert.equal(frames.params, 'fade');
    assert.ok(frames.toString().includes('rgba('));
    assert.ok(
      out.nodes.some(
        n =>
          n.type === 'atrule' &&
          n.name === 'supports' &&
          n.nodes.some(c => c.type === 'atrule' && c.name === 'keyframes')
      )
    );
  });

  it('a second pass is byte-identical including runtime resolvers', async () => {
    const css =
      ':root { --color-primary: oklch(.6 .1 40); } .box { background: color-mix(in srgb, var(--color-primary), transparent); }';
    const f = project(css);
    const once = await transform(css, f.root, f.file);
    const twice = await transform(once, f.root, f.file);
    assert.equal(twice, once);
  });

  it('undefined color variables without a fallback fail closed', async () => {
    const css =
      '.box { color: color-mix(in srgb, var(--missing-color) 20%, white); }';
    const f = project(css, 'src/UI/components/example.css');
    await assert.rejects(
      transform(css, f.root, f.file),
      /No source or runtime channels declared for --missing-color/
    );
  });

  it('global stylesheet defines matching legacy and modern runtime selectors', async () => {
    const css = ':root { --color-primary: #fff; }';
    const f = project(css);
    const out = postcss.parse(await transform(css, f.root, f.file));
    const support = out.nodes.find(
      n =>
        n.type === 'atrule' &&
        n.name === 'supports' &&
        n.params === MODERN_COLOR_SUPPORT
    );
    for (const name of RUNTIME_COLOR_VARIABLES) {
      const selector = `:where([style*="${legacyVariableName(name)}:"])`;
      const base = out.nodes.find(
        n => n.type === 'rule' && n.selector === selector
      );
      const modern = support.nodes.find(
        n => n.type === 'rule' && n.selector === selector
      );
      assert.ok(base, selector);
      assert.ok(modern, selector);
      assert.equal(declarations(base)[0][0], resolverVariableName(name));
      assert.equal(declarations(modern)[0][0], resolverVariableName(name));
      assert.notEqual(declarations(base)[0][1], declarations(modern)[0][1]);
    }
  });

  it('all shipped UI stylesheets transform without dropping unsupported colors silently', async () => {
    const root = projectRoot;
    const files = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.endsWith('.css')) files.push(file);
      }
    }
    walk(path.join(root, 'src/UI'));
    expect(files.length).toBeGreaterThan(0);
    const failures = [];
    for (const file of files) {
      try {
        const once = await transform(fs.readFileSync(file, 'utf8'), root, file);
        const twice = await transform(once, root, file);
        if (twice !== once)
          failures.push(
            `${path.relative(root, file)}: second pass changed output`
          );
      } catch (error) {
        failures.push(`${path.relative(root, file)}: ${error.message}`);
      }
    }
    assert.deepEqual(failures, []);
    // Two passes over every UI stylesheet are an integration census, not a 5s performance SLO.
  }, 20_000);

  it.each([
    ['hsl(120 100% 50%)', ['0', '255', '0', '1']],
    ['red', ['255', '0', '0', '1']],
  ])(
    'runtime status color %s supplies its actual channels to the legacy mix',
    (color, expected) => {
      const {
        colorVariableStyle,
      } = require('./src/application/colors/color-css-variables.ts');
      const style = colorVariableStyle('--statusColor', color);
      assert.deepEqual(
        ['r', 'g', 'b', 'a'].map(key => style[`--nf-c-statusColor-${key}`]),
        expected
      );
    }
  );

  it('runtime resolver selectors match styles emitted by the real color producer', async () => {
    const css = ':root { --color-primary: #fff; }';
    const fixture = project(css);
    const output = postcss.parse(
      await transform(css, fixture.root, fixture.file)
    );
    const modern = output.nodes.find(
      node =>
        node.type === 'atrule' &&
        node.name === 'supports' &&
        node.params === MODERN_COLOR_SUPPORT
    );
    const {
      colorVariableStyle,
    } = require('./src/application/colors/color-css-variables.ts');
    for (const name of RUNTIME_COLOR_VARIABLES) {
      const style = colorVariableStyle(name, 'oklch(.6 .15 20)');
      const element = globalThis.document.createElement('div');
      for (const [key, value] of Object.entries(style))
        element.style.setProperty(key, value);
      const selector = `:where([style*="${legacyVariableName(name)}:"])`;
      assert.equal(
        element.matches(selector),
        true,
        `${name}: ${element.getAttribute('style')}`
      );
      const baseRule = output.nodes.find(
        node => node.type === 'rule' && node.selector === selector
      );
      const modernRule = modern.nodes.find(
        node => node.type === 'rule' && node.selector === selector
      );
      assert.equal(
        declarations(baseRule)[0][1],
        `var(${legacyVariableName(name)})`
      );
      assert.equal(declarations(modernRule)[0][1], `var(${name}-nf-modern)`);
    }
  });

  it('important channels follow the winning custom-property declaration', async () => {
    const css =
      ':root { --color-a: #112233 !important; --color-a: #abcdef; } .x { color: color-mix(in srgb, var(--color-a), white); }';
    const fixture = project(css, 'src/UI/components/example.css');
    const output = postcss.parse(
      await transform(css, fixture.root, fixture.file)
    );
    const root = output.nodes.find(
      node => node.type === 'rule' && node.selector === ':root'
    );
    const reds = declarations(root).filter(
      ([name]) => name === '--nf-c-color-a-r'
    );
    assert.deepEqual(reds, [
      ['--nf-c-color-a-r', '17', true],
      ['--nf-c-color-a-r', '171', undefined],
    ]);
  });

  it('a var-containing modern shorthand remains guarded with the complete winning family', async () => {
    const css =
      ':root { --color-a: oklch(.6 .1 20); } .x { background-color: #111; background: var(--color-a, color-mix(in srgb, #fff, black)) !important; background-color: #333; }';
    const fixture = project(css, 'src/UI/components/example.css');
    const output = postcss.parse(
      await transform(css, fixture.root, fixture.file)
    );
    const baseRoot = output.nodes.find(
      node => node.type === 'rule' && node.selector === ':root'
    );
    const base = output.nodes.find(
      node => node.type === 'rule' && node.selector === '.x'
    );
    const guarded = output.nodes.find(
      node =>
        node.type === 'atrule' &&
        node.name === 'supports' &&
        node.nodes.some(
          child => child.type === 'rule' && child.selector === '.x'
        )
    );
    const modern = guarded.nodes.find(
      node => node.type === 'rule' && node.selector === '.x'
    );
    assert.match(
      declarations(baseRoot).find(([name]) => name === '--color-a')[1],
      /^rgba\(/
    );
    assert.match(
      declarations(base).find(([name]) => name === 'background')[1],
      /var\(--color-a, rgba\(/
    );
    assert.deepEqual(declarations(modern), [
      ['background-color', '#111', undefined],
      ['background', 'var(--color-a, color-mix(in srgb, #fff, black))', true],
      ['background-color', '#333', undefined],
    ]);
  });

  it('missing mix variable uses a literal fallback independently for every channel', async () => {
    const css =
      '.x { color: color-mix(in srgb, var(--undefined, #f00) 40%, transparent); }';
    const fixture = project(css, 'src/UI/components/example.css');
    const output = postcss.parse(
      await transform(css, fixture.root, fixture.file)
    );
    const base = output.nodes.find(
      node => node.type === 'rule' && node.selector === '.x'
    );
    const color = declarations(base).find(([name]) => name === 'color')[1];
    assert.match(color, /var\(--nf-c-undefined-r, 255\)/);
    assert.match(color, /var\(--nf-c-undefined-g, 0\)/);
    assert.match(color, /var\(--nf-c-undefined-b, 0\)/);
    assert.match(color, /var\(--nf-c-undefined-a, 1\)/);
  });

  it('author-protected modern rules are not duplicated or transformed', async () => {
    const css = `@supports ${MODERN_COLOR_SUPPORT} { .x { color: color-mix(in oklch, #fff, black); } }`;
    const fixture = project(css, 'src/UI/components/example.css');
    const once = await transform(css, fixture.root, fixture.file);
    assert.equal(once, css);
    assert.equal(await transform(once, fixture.root, fixture.file), css);
  });

  it('alias fallback metadata follows rebindings in a media scope', async () => {
    const css =
      ':root { --color-main: #112233; --color-alias: var(--color-main, #fff); } @media (min-width: 40rem) { .x { --color-main: #abcdef; color: color-mix(in srgb, var(--color-alias), transparent); } }';
    const fixture = project(css, 'src/UI/components/example.css');
    const output = postcss.parse(
      await transform(css, fixture.root, fixture.file)
    );
    const root = output.nodes.find(
      node => node.type === 'rule' && node.selector === ':root'
    );
    const media = output.nodes.find(
      node => node.type === 'atrule' && node.name === 'media'
    );
    const scoped = media.nodes.find(
      node => node.type === 'rule' && node.selector === '.x'
    );
    const aliasRed = declarations(root).find(
      ([name]) => name === '--nf-c-color-alias-r'
    )[1];
    assert.equal(aliasRed, 'var(--nf-c-color-main-r, 255)');
    assert.equal(
      declarations(scoped).find(([name]) => name === '--nf-c-color-main-r')[1],
      '171'
    );
  });
});
