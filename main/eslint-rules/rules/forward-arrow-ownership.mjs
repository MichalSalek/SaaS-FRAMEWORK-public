// nf/forward-arrow-ownership — the button primitive draws its own forward arrow.
//
// Successor of tests/audit/forward-arrow-ownership.sh (scanner lib/forward-arrow-scan.cjs).
// Button primitives are the exported components of src/UI/components/Button/*.atom.tsx that
// take a `direction` prop, discovered, not listed. A labelled call must not receive
// ArrowRight / CaretRight (or an alias) through `icon` or inside the label.
// Escape: `// forward-arrow-allow: <reason>` in a comment of the file. An icon-only
// button may be a bare arrow. Presence counts `direction='forward'` call sites.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { countSite } from '../lib.mjs';
import { hasEscapeWithReason, relativeFile } from './_guard-files.mjs';

const BUTTON_DIR = 'src/UI/components/Button';
const WORKSPACE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

const isForwardGlyph = name =>
  /^(Arrow|Caret)[A-Za-z]*Right(Icon)?$/.test(name) &&
  !/(Up|Down|Left)/.test(name);

function discoverPrimitives() {
  const dir = path.join(WORKSPACE, BUTTON_DIR);
  const names = new Set();
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.atom.tsx')) {
      continue;
    }
    const source = ts.createSourceFile(
      entry,
      readFileSync(path.join(dir, entry), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    let declaresDirection = false;
    const exported = [];
    const visit = node => {
      if (
        (ts.isPropertySignature(node) || ts.isBindingElement(node)) &&
        node.name &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'direction'
      ) {
        declaresDirection = true;
      }
      const exportedNode =
        (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
        node.name &&
        (ts.getModifiers(node) ?? []).some(
          m => m.kind === ts.SyntaxKind.ExportKeyword
        );
      if (exportedNode) {
        exported.push(node.name.text);
      }
      if (
        ts.isVariableStatement(node) &&
        (ts.getModifiers(node) ?? []).some(
          m => m.kind === ts.SyntaxKind.ExportKeyword
        )
      ) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            exported.push(decl.name.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (declaresDirection) {
      exported
        .filter(name => /^[A-Z]/.test(name))
        .forEach(name => names.add(name));
    }
  }
  if (names.size === 0) {
    throw new Error(
      `nf/forward-arrow-ownership: no button primitive with a direction prop in ${BUTTON_DIR}`
    );
  }
  return names;
}

export const PRIMITIVES = discoverPrimitives();

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') {
    return;
  }
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, visit);
      }
    } else if (value && typeof value === 'object') {
      walk(value, visit);
    }
  }
}

function tagName(opening) {
  if (opening.name?.type === 'JSXIdentifier') {
    return opening.name.name;
  }
  return null;
}

function glyphIn(node, glyphs) {
  let found = null;
  walk(node, current => {
    if (found || current.type !== 'JSXOpeningElement') {
      return;
    }
    const simple = tagName(current);
    if (simple && (glyphs.has(simple) || isForwardGlyph(simple))) {
      found = simple;
      return;
    }
    const member =
      current.name?.type === 'JSXMemberExpression'
        ? current.name.property?.name
        : null;
    if (member && (glyphs.has(member) || isForwardGlyph(member))) {
      found = member;
    }
  });
  return found;
}

function isForwardDirection(attr) {
  const init = attr.value;
  if (!init) {
    return false;
  }
  if (init.type === 'Literal') {
    return init.value === 'forward';
  }
  if (
    init.type === 'JSXExpressionContainer' &&
    init.expression.type === 'Literal'
  ) {
    return init.expression.value === 'forward';
  }
  return false;
}

function hasLabel(element) {
  return element.children.some(
    child => child.type !== 'JSXText' || !/^[\s]*$/.test(child.value)
  );
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A labelled button gets its forward arrow only through direction="forward".',
    },
    schema: [],
    messages: {
      hand: '<{{tag}}> gets {{glyph}} by hand ({{where}}). Remove the glyph and write direction="forward".',
    },
  },
  create(context) {
    if (relativeFile(context).includes('.test.')) {
      return {};
    }
    const sourceCode = context.sourceCode;
    const glyphs = new Set();
    const localPrimitives = new Set(PRIMITIVES);
    return {
      ImportDeclaration(node) {
        if (node.importKind === 'type') {
          return;
        }
        for (const spec of node.specifiers) {
          if (spec.type !== 'ImportSpecifier') {
            continue;
          }
          const imported =
            spec.imported.type === 'Identifier' ? spec.imported.name : null;
          if (imported && PRIMITIVES.has(imported)) {
            localPrimitives.add(spec.local.name);
          }
          if (imported && isForwardGlyph(imported)) {
            glyphs.add(spec.local.name);
          }
        }
      },
      JSXElement(node) {
        const opening = node.openingElement;
        const tag = tagName(opening);
        if (!tag || !localPrimitives.has(tag)) {
          return;
        }
        const escaped = hasEscapeWithReason(sourceCode, 'forward-arrow-allow');
        for (const attr of opening.attributes) {
          if (
            attr.type !== 'JSXAttribute' ||
            attr.name.type !== 'JSXIdentifier'
          ) {
            continue;
          }
          if (attr.name.name === 'direction' && isForwardDirection(attr)) {
            countSite('forward-arrow-ownership');
          }
          if (attr.name.name === 'icon' && hasLabel(node) && !escaped) {
            const glyph = glyphIn(attr.value ?? attr, glyphs);
            if (glyph) {
              context.report({
                node: attr,
                messageId: 'hand',
                data: { tag, glyph, where: 'icon' },
              });
            }
          }
        }
        if (escaped) {
          return;
        }
        for (const child of node.children) {
          const glyph = glyphIn(child, glyphs);
          if (glyph) {
            context.report({
              node: child,
              messageId: 'hand',
              data: { tag, glyph, where: 'label' },
            });
          }
        }
      },
    };
  },
};

export default {
  name: 'forward-arrow-ownership',
  replaces: 'tests/audit/forward-arrow-ownership.sh',
  rule,
  blocks: [
    {
      files: ['src/**/*.tsx'],
      ignores: ['**/*.test.tsx'],
    },
  ],
  presence: {
    minSites: 30,
    what: "direction='forward' call sites in main/src (measured about 55)",
  },
  paths: [BUTTON_DIR],
};
