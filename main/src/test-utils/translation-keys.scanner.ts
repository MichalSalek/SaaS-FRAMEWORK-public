// Static translation-key scanner (TypeScript compiler API). Used by
// application/i18n/translation-keys.test.ts against the real source tree and
// against standalone fixtures.
//
// A translator is recognised by its TYPE (a callable with `has`, `rich`, `raw`
// and `markup`), never by its variable name. Its namespace comes from the
// binding (`useTranslations('ns')`, `await getTranslations({ namespace })`) or
// from the declared type of a parameter / prop
// (`ReturnType<typeof useTranslations<'ns'>>`, through type aliases). Keys are
// checked when they are literals, template literals whose interpolations have
// literal-union types, or expressions of a literal-union type.

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type MessageTree = Record<string, unknown>;

export type TranslationSite = {
  file: string;
  line: number;
  text: string;
};

export type MissingKey = TranslationSite & {
  locale: string;
  key: string;
  reason: 'missing' | 'not-a-string';
};

export type TranslationScan = {
  /** Call sites whose namespace and every key were resolved and looked up. */
  checked: TranslationSite[];
  /** Resolved keys absent (or not a string) in a locale. */
  missing: MissingKey[];
  /** Missing keys inside a `t.has(<same key>)` guard (allowed). */
  guarded: MissingKey[];
  /** Namespace known, key not reducible to literals (plain `string`). */
  unverifiableKey: TranslationSite[];
  /** Translator whose namespace cannot be read (bare `ReturnType<typeof useTranslations>`, untyped). */
  unverifiableTranslator: TranslationSite[];
  /**
   * A translator handed to a parameter / prop declared for ANOTHER namespace. Without next-intl's
   * AppConfig the namespace type argument does not change the translator's type, so tsc accepts the
   * mismatch; this check is what makes a `<'ns'>` annotation trustworthy.
   */
  namespaceMismatch: (TranslationSite & { passed: string; declared: string })[];
  /** Translator passed into an undeclared (bare) slot: `{ passed }` names what the slot should say. */
  untypedSlot: (TranslationSite & { passed: string })[];
};

const TRANSLATOR_FACTORIES = new Set(['useTranslations', 'getTranslations']);
const VARIANT_METHODS = new Set(['rich', 'markup', 'raw']);
const UNRESOLVED = Symbol('unresolved');
type Namespace = string | typeof UNRESOLVED;

export function loadAppMessages(srcRoot: string): Record<string, MessageTree> {
  const out: Record<string, MessageTree> = {};
  for (const locale of ['pl', 'en', 'de']) {
    const dir = path.join(srcRoot, 'locales', locale);
    const common = JSON.parse(
      fs.readFileSync(path.join(dir, 'common.json'), 'utf8')
    ) as MessageTree;
    common.events = JSON.parse(
      fs.readFileSync(path.join(dir, 'events.json'), 'utf8')
    ) as MessageTree;
    out[locale] = common;
  }
  return out;
}

export function createProjectProgram(tsconfigPath: string): ts.Program {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfigPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: diagnostic => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        );
      },
    }
  );
  if (!parsed) {
    throw new Error(`Cannot parse ${tsconfigPath}`);
  }
  const { tsBuildInfoFile: _unused, ...options } = parsed.options;
  return ts.createProgram(parsed.fileNames, {
    ...options,
    noEmit: true,
    incremental: false,
  });
}

/** In-memory program over virtual `.tsx` files (fixtures have no imports). */
export function createVirtualProgram(
  files: Record<string, string>
): ts.Program {
  const options: ts.CompilerOptions = {
    strict: true,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);
  const baseReadFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName in files
      ? ts.createSourceFile(fileName, files[fileName], languageVersion, true)
      : baseGetSourceFile(fileName, languageVersion, ...rest);
  host.fileExists = fileName => fileName in files || baseFileExists(fileName);
  host.readFile = fileName =>
    fileName in files ? files[fileName] : baseReadFile(fileName);
  return ts.createProgram(Object.keys(files), options, host);
}

const lookup = (
  tree: MessageTree,
  dottedPath: string
): 'string' | 'other' | 'missing' => {
  let node: unknown = tree;
  for (const segment of dottedPath.split('.')) {
    if (
      node === null ||
      typeof node !== 'object' ||
      !Object.prototype.hasOwnProperty.call(node, segment)
    ) {
      return 'missing';
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? 'string' : 'other';
};

export function scanTranslationKeys({
  program,
  messages,
  includeFile,
  relativeTo,
}: {
  program: ts.Program;
  messages: Record<string, MessageTree>;
  includeFile: (fileName: string) => boolean;
  relativeTo: string;
}): TranslationScan {
  const checker = program.getTypeChecker();
  const result: TranslationScan = {
    checked: [],
    missing: [],
    guarded: [],
    unverifiableKey: [],
    unverifiableTranslator: [],
    namespaceMismatch: [],
    untypedSlot: [],
  };

  const isTranslatorType = (node: ts.Node): boolean => {
    const type = checker.getTypeAtLocation(node);
    return (
      type.getCallSignatures().length > 0 &&
      ['has', 'rich', 'raw', 'markup'].every(
        name => type.getProperty(name) !== undefined
      )
    );
  };

  /** Literal values of an expression's type, or null when any member is not a literal. */
  const literalValues = (expr: ts.Expression): string[] | null => {
    const type = checker.getTypeAtLocation(expr);
    const members = type.isUnion() ? type.types : [type];
    const values: string[] = [];
    for (const member of members) {
      if (member.isStringLiteral()) {
        values.push(member.value);
      } else if (member.isNumberLiteral()) {
        values.push(String(member.value));
      } else if (
        (member.flags & ts.TypeFlags.Null) !== 0 ||
        (member.flags & ts.TypeFlags.Undefined) !== 0
      ) {
        continue;
      } else {
        return null;
      }
    }
    return values.length > 0 ? values : null;
  };

  const keysOf = (arg: ts.Expression): string[] | null => {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
      return [arg.text];
    }
    if (ts.isTemplateExpression(arg)) {
      let keys = [arg.head.text];
      for (const span of arg.templateSpans) {
        const values = literalValues(span.expression);
        if (!values) {
          return null;
        }
        const next: string[] = [];
        for (const prefix of keys) {
          for (const value of values) {
            next.push(prefix + value + span.literal.text);
          }
        }
        keys = next;
      }
      return keys;
    }
    return literalValues(arg);
  };

  const namespaceFromFactoryCall = (call: ts.CallExpression): Namespace => {
    if (call.arguments.length === 0) {
      return '';
    }
    const arg = call.arguments[0];
    if (ts.isObjectLiteralExpression(arg)) {
      for (const property of arg.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          property.name.getText() === 'namespace'
        ) {
          const values = literalValues(property.initializer);
          return values?.length === 1 ? values[0] : UNRESOLVED;
        }
      }
      return '';
    }
    const values = literalValues(arg);
    return values?.length === 1 ? values[0] : UNRESOLVED;
  };

  const namespaceFromTypeNode = (
    node: ts.TypeNode | undefined,
    depth: number
  ): Namespace => {
    if (!node || depth > 8) {
      return UNRESOLVED;
    }
    if (ts.isParenthesizedTypeNode(node)) {
      return namespaceFromTypeNode(node.type, depth + 1);
    }
    if (ts.isTypeQueryNode(node)) {
      if (!TRANSLATOR_FACTORIES.has(node.exprName.getText())) {
        // `typeof t`: the namespace of the translator it names.
        return ts.isIdentifier(node.exprName)
          ? namespaceOfExpression(node.exprName, depth + 1)
          : UNRESOLVED;
      }
      const typeArg = node.typeArguments?.[0];
      if (
        typeArg &&
        ts.isLiteralTypeNode(typeArg) &&
        ts.isStringLiteral(typeArg.literal)
      ) {
        return typeArg.literal.text;
      }
      return UNRESOLVED;
    }
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText();
      if (name === 'ReturnType' || name === 'Awaited') {
        return namespaceFromTypeNode(node.typeArguments?.[0], depth + 1);
      }
      let symbol = checker.getSymbolAtLocation(node.typeName);
      if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
        symbol = checker.getAliasedSymbol(symbol);
      }
      const alias = symbol?.declarations?.find(ts.isTypeAliasDeclaration);
      return alias ? namespaceFromTypeNode(alias.type, depth + 1) : UNRESOLVED;
    }
    return UNRESOLVED;
  };

  /** Namespace of property `name` on `ownerType` (declared type or initializer). */
  const namespaceOfProperty = (
    ownerType: ts.Type,
    name: string,
    depth: number
  ): Namespace => {
    const property = checker.getPropertyOfType(
      checker.getApparentType(ownerType),
      name
    );
    const declaration = property?.declarations?.[0];
    return declaration
      ? namespaceOfDeclaration(declaration, depth + 1)
      : UNRESOLVED;
  };

  const namespaceOfDeclaration = (
    declaration: ts.Declaration,
    depth: number
  ): Namespace => {
    if (depth > 8) {
      return UNRESOLVED;
    }
    if (ts.isVariableDeclaration(declaration)) {
      if (declaration.type) {
        return namespaceFromTypeNode(declaration.type, 0);
      }
      return declaration.initializer
        ? namespaceOfInitializer(declaration.initializer, depth)
        : UNRESOLVED;
    }
    if (
      ts.isParameter(declaration) ||
      ts.isPropertySignature(declaration) ||
      ts.isPropertyDeclaration(declaration)
    ) {
      return namespaceFromTypeNode(declaration.type, 0);
    }
    if (ts.isBindingElement(declaration)) {
      const pattern = declaration.parent;
      const owner = pattern.parent;
      const propertyName = (
        declaration.propertyName ?? declaration.name
      ).getText();
      if (ts.isParameter(owner) || ts.isVariableDeclaration(owner)) {
        const ownerType = owner.type
          ? checker.getTypeFromTypeNode(owner.type)
          : checker.getTypeAtLocation(owner.name);
        return namespaceOfProperty(ownerType, propertyName, depth);
      }
      return UNRESOLVED;
    }
    if (ts.isPropertyAssignment(declaration)) {
      return namespaceOfInitializer(declaration.initializer, depth);
    }
    if (ts.isShorthandPropertyAssignment(declaration)) {
      const symbol = checker.getShorthandAssignmentValueSymbol(declaration);
      const target = symbol?.declarations?.[0];
      return target ? namespaceOfDeclaration(target, depth + 1) : UNRESOLVED;
    }
    return UNRESOLVED;
  };

  function namespaceOfInitializer(
    expression: ts.Expression,
    depth: number
  ): Namespace {
    let init = expression;
    while (ts.isAwaitExpression(init) || ts.isParenthesizedExpression(init)) {
      init = init.expression;
    }
    if (
      ts.isCallExpression(init) &&
      TRANSLATOR_FACTORIES.has(init.expression.getText())
    ) {
      return namespaceFromFactoryCall(init);
    }
    if (ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) {
      return namespaceOfExpression(init, depth + 1);
    }
    return UNRESOLVED;
  }

  function namespaceOfExpression(
    expr: ts.Expression,
    depth: number
  ): Namespace {
    const nameNode = ts.isPropertyAccessExpression(expr) ? expr.name : expr;
    const symbol = checker.getSymbolAtLocation(nameNode);
    const declaration = symbol?.declarations?.[0];
    return declaration
      ? namespaceOfDeclaration(declaration, depth)
      : UNRESOLVED;
  }

  /** True when the call sits in the truthy branch of `<translator>.has(<same key>)`. */
  const isGuardedByHas = (
    call: ts.CallExpression,
    translatorText: string,
    keyText: string
  ): boolean => {
    const guard = `${translatorText}.has(${keyText})`;
    const normalise = (text: string) => text.replace(/\s+/g, '');
    let node: ts.Node = call;
    while (!ts.isSourceFile(node)) {
      const parent = node.parent;
      if (ts.isFunctionLike(parent) || ts.isSourceFile(parent)) {
        break;
      }
      if (
        (ts.isIfStatement(parent) && parent.thenStatement === node) ||
        (ts.isConditionalExpression(parent) && parent.whenTrue === node) ||
        (ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
          parent.right === node)
      ) {
        const condition = ts.isIfStatement(parent)
          ? parent.expression
          : ts.isConditionalExpression(parent)
            ? parent.condition
            : parent.left;
        if (normalise(condition.getText()).includes(normalise(guard))) {
          return true;
        }
      }
      node = parent;
    }
    return false;
  };

  /** Cheap syntactic pre-filter for `declaredSlotNamespace`. */
  const isSlotPosition = (expr: ts.Expression): boolean => {
    const parent = expr.parent;
    return (
      ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
        parent.expression !== expr) ||
      (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === expr) ||
      ts.isShorthandPropertyAssignment(parent)
    );
  };

  /** Namespace declared by the slot `expr` is passed into (argument, prop, object property). */
  const declaredSlotNamespace = (
    expr: ts.Expression
  ): Namespace | 'not-a-slot' => {
    const parent = expr.parent;
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      const index = parent.arguments?.indexOf(expr) ?? -1;
      if (index < 0) {
        return 'not-a-slot';
      }
      const signature = checker.getResolvedSignature(parent);
      const params = signature?.getParameters() ?? [];
      const param = params[Math.min(index, params.length - 1)];
      const declaration = param?.declarations?.[0];
      return declaration ? namespaceOfDeclaration(declaration, 0) : UNRESOLVED;
    }
    if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
      const attributes = parent.parent.parent;
      const contextual = checker.getContextualType(attributes);
      const property = contextual
        ? checker.getPropertyOfType(contextual, parent.parent.name.getText())
        : undefined;
      const declaration = property?.declarations?.[0];
      return declaration ? namespaceOfDeclaration(declaration, 0) : UNRESOLVED;
    }
    if (
      (ts.isPropertyAssignment(parent) && parent.initializer === expr) ||
      ts.isShorthandPropertyAssignment(parent)
    ) {
      const literal = parent.parent;
      const contextual = checker.getContextualType(literal);
      if (!contextual) {
        return 'not-a-slot';
      }
      const property = checker.getPropertyOfType(
        contextual,
        parent.name.getText()
      );
      const declaration = property?.declarations?.[0];
      if (!declaration || declaration === parent) {
        return 'not-a-slot';
      }
      return namespaceOfDeclaration(declaration, 0);
    }
    return 'not-a-slot';
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || !includeFile(sourceFile.fileName)) {
      continue;
    }
    const file = path.relative(relativeTo, sourceFile.fileName);
    const siteOf = (node: ts.Node): TranslationSite => ({
      file,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      text: node.getText().slice(0, 120),
    });
    const visit = (node: ts.Node): void => {
      if (
        (ts.isIdentifier(node) ||
          ts.isPropertyAccessExpression(node) ||
          (ts.isCallExpression(node) &&
            TRANSLATOR_FACTORIES.has(node.expression.getText()))) &&
        isSlotPosition(node) &&
        isTranslatorType(node)
      ) {
        const declared = declaredSlotNamespace(node);
        if (declared !== 'not-a-slot') {
          const passed = namespaceOfInitializer(node, 0);
          if (passed !== UNRESOLVED && declared === UNRESOLVED) {
            result.untypedSlot.push({ ...siteOf(node.parent), passed });
          } else if (
            passed !== UNRESOLVED &&
            declared !== UNRESOLVED &&
            passed !== declared
          ) {
            result.namespaceMismatch.push({
              ...siteOf(node.parent),
              passed,
              declared,
            });
          }
        }
      }
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        let translator: ts.Expression = node.expression;
        if (
          ts.isPropertyAccessExpression(translator) &&
          VARIANT_METHODS.has(translator.name.text)
        ) {
          translator = translator.expression;
        }
        if (
          (ts.isIdentifier(translator) ||
            ts.isPropertyAccessExpression(translator)) &&
          isTranslatorType(translator)
        ) {
          const site: TranslationSite = {
            file,
            line:
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1,
            text: node.getText().slice(0, 120),
          };
          const namespace = namespaceOfExpression(translator, 0);
          if (namespace === UNRESOLVED) {
            result.unverifiableTranslator.push(site);
          } else {
            const arg = node.arguments[0];
            const keys = keysOf(arg);
            if (!keys) {
              result.unverifiableKey.push(site);
            } else {
              result.checked.push(site);
              const isRaw =
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === 'raw';
              const guarded = isGuardedByHas(
                node,
                translator.getText(),
                arg.getText()
              );
              for (const key of keys) {
                const full = namespace ? `${namespace}.${key}` : key;
                for (const [locale, tree] of Object.entries(messages)) {
                  const found = lookup(tree, full);
                  if (found === 'missing' || (found === 'other' && !isRaw)) {
                    const entry: MissingKey = {
                      ...site,
                      locale,
                      key: full,
                      reason: found === 'missing' ? 'missing' : 'not-a-string',
                    };
                    (guarded ? result.guarded : result.missing).push(entry);
                  }
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return result;
}

/** `{ file: count }` of unverifiable sites (both kinds), sorted by file. */
export function countByFile(sites: TranslationSite[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const site of [...sites].sort((a, b) => a.file.localeCompare(b.file))) {
    counts[site.file] = (counts[site.file] ?? 0) + 1;
  }
  return counts;
}
