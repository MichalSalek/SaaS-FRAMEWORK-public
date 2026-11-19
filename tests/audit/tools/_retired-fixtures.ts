// Fixture samples of retired shell guards whose successor tests read them by name.
// The `.expect` files were messages of the old scripts and are not kept.

/** Samples of the retired tests/audit/_fixtures/prisma-fk-index (git history), inlined so the proof outlives the directory. */
export const PRISMA_FK_INDEX_SAMPLES: Readonly<
  Record<'must-fail' | 'must-pass', Readonly<Record<string, string>>>
> = {
  'must-fail': {
    'web-1%src%prisma%schema.prisma':
      'model Link {\n  parent_id String\n  child_id String\n  parent Parent @relation(fields: [parent_id], references: [id])\n  @@id([child_id, parent_id])\n}\n',
  },
  'must-pass': {
    'web-1%src%prisma%schema.prisma':
      'model Link {\n  parent_id String\n  child_id String\n  parent Parent @relation(fields: [parent_id], references: [id])\n  @@id([parent_id, child_id])\n}\n',
  },
};

/** Samples of the retired tests/audit/_fixtures/typescript-strictness (git history), inlined so the proof outlives the directory. */
export const TYPESCRIPT_STRICTNESS_SAMPLES: Readonly<
  Record<'must-fail' | 'must-pass', Readonly<Record<string, string>>>
> = {
  'must-fail': {
    'any-annotation.ts':
      '// Pr\u00f3bka \u0142ami\u0105ca regu\u0142\u0119: jawny typ `any` w sygnaturze.\nexport const parse = (raw: string): any => JSON.parse(raw);\n',
    'as-any-cast.ts':
      'export const marker = (globalThis as any).__nailfolioMarker;\n',
    'non-null-assertion.ts':
      'export const first = (xs: readonly string[]): string => xs[0]!.trim();\n',
    'ts-ignore-directive.ts':
      '// @ts-ignore\nexport const legacyBridge = globalThis.__nailfolioLegacyBridge;\n',
  },
  'must-pass': {
    'any-in-comments.ts':
      '// Fail-open: any parse error is swallowed here on purpose.\n/**\n * Returns: any of the configured hosts, whichever answers first.\n * Do not cast `as any` \u2014 see the DECISION in http.utils.ts.\n * The old `token!.value` idiom is gone; keep it out of this file.\n */\nexport const hosts = (list: readonly string[]): string[] => [...list];\n',
    'jsx-comment-any.tsx':
      "export const Note = (): string => {\n  const kind = 'note';\n  {/* Legacy prop bag was typed: any \u2014 replaced with a discriminated union. */}\n  return kind;\n};\n",
    'ts-ignore-in-prose.ts':
      "/**\n * This declaration replaces a `@ts-ignore` on the import (project rule: no\n * permanent compiler silencers). See tests/audit/typescript-strictness.sh.\n */\nexport const bridgeName = '__nailfolioLegacyBridge';\n",
  },
};
