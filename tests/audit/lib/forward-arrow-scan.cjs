/**
 * Scanner behind forward-arrow-ownership.sh.
 *
 * Reads every .tsx under <src-root> through the TypeScript parser (an AST, so a
 * prop broken across lines, an aliased import, a ternary inside the prop, a
 * comment or a string literal quoting the wrong form all behave correctly) and
 * prints one tab-separated record per line:
 *
 *   PRIMITIVE <name>                 button primitives discovered in <button-dir>
 *   SITE      <file> <line>          a `direction='forward'` call site (presence floor)
 *   HIT       <file> <line> <tag> <glyph> <where>   a forward glyph next to a label:
 *                                    handed in through `icon`, or drawn inside the label
 *
 * Usage: node forward-arrow-scan.cjs <src-root> <button-dir>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const [srcRoot, buttonDir] = process.argv.slice(2);
if (!srcRoot || !buttonDir) {
  console.error('usage: forward-arrow-scan.cjs <src-root> <button-dir>');
  process.exit(2);
}

/** A Phosphor glyph that points forward: ArrowRight, CaretRight and their
 *  framed siblings. Diagonals and two-way arrows mean something else. */
const isForwardGlyph = name =>
  /^(Arrow|Caret)[A-Za-z]*Right(Icon)?$/.test(name) &&
  !/(Up|Down|Left)/.test(name);

const walk = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'READONLY-shared-kernel' ||
        entry.name === 'node_modules'
        ? []
        : walk(full);
    }
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
      ? [full]
      : [];
  });

const parse = file =>
  ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

const hasExportModifier = node =>
  (ts.getModifiers(node) ?? []).some(
    m => m.kind === ts.SyntaxKind.ExportKeyword
  );

/** Button primitives = exported components of the button directory that take a
 *  `direction` prop. Discovered, so a third primitive is covered the day it is
 *  written and a rename cannot leave the guard watching a dead name. */
function discoverPrimitives() {
  const names = new Set();
  for (const entry of fs.readdirSync(buttonDir)) {
    if (!/\.atom\.tsx$/.test(entry)) continue;
    const source = parse(path.join(buttonDir, entry));
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
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        hasExportModifier(node)
      ) {
        exported.push(node.name.text);
      }
      if (ts.isVariableStatement(node) && hasExportModifier(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) exported.push(decl.name.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (declaresDirection) {
      exported.filter(n => /^[A-Z]/.test(n)).forEach(n => names.add(n));
    }
  }
  return names;
}

const primitives = discoverPrimitives();
for (const name of primitives) console.log(`PRIMITIVE\t${name}`);

const lineOf = (source, node) =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

const hasLabel = element =>
  ts.isJsxElement(element) &&
  element.children.some(
    child => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces)
  );

function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  // Cheap pre-filter: a file that never names a primitive cannot hold a site.
  if (![...primitives].some(name => text.includes(name))) return;
  const source = parse(file);

  // Local names: an aliased import must not slip past either set.
  const localPrimitives = new Set(primitives);
  const localGlyphs = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const spec of bindings.elements) {
      const imported = (spec.propertyName ?? spec.name).text;
      if (primitives.has(imported)) localPrimitives.add(spec.name.text);
      if (isForwardGlyph(imported)) localGlyphs.add(spec.name.text);
    }
  }

  const glyphIn = node => {
    let found = null;
    const visit = child => {
      if (found) return;
      if (ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) {
        const tag = child.tagName.getText(source);
        if (localGlyphs.has(tag) || isForwardGlyph(tag)) {
          found = tag;
          return;
        }
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };

  const relative = path.relative(process.cwd(), file);
  const visit = node => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening && localPrimitives.has(opening.tagName.getText(source))) {
      for (const attr of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
        const attrName = attr.name.getText(source);
        if (
          attrName === 'direction' &&
          /^(['"])forward\1$/.test(
            attr.initializer.getText(source).replace(/^\{|\}$/g, '')
          )
        ) {
          console.log(`SITE\t${relative}\t${lineOf(source, attr)}`);
        }
        // An icon-only button (no label) may be a bare arrow: the rule is about
        // an arrow NEXT TO a label, where its side is the whole point.
        if (attrName === 'icon' && hasLabel(node)) {
          const glyph = glyphIn(attr.initializer);
          if (glyph) {
            console.log(
              `HIT\t${relative}\t${lineOf(source, attr)}\t${opening.tagName.getText(source)}\t${glyph}\ticon`
            );
          }
        }
      }
      // The same arrow drawn by hand INSIDE the label is the same defect with
      // one more way to drift (own size, own weight, own gap).
      if (ts.isJsxElement(node)) {
        for (const child of node.children) {
          const glyph = glyphIn(child);
          if (glyph) {
            console.log(
              `HIT\t${relative}\t${lineOf(source, child)}\t${opening.tagName.getText(source)}\t${glyph}\tlabel`
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

for (const file of walk(srcRoot)) scanFile(file);
