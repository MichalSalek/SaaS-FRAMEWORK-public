// What counts as "the Prisma client module" for the Prisma guard rules (not a rule: `_` prefix).
// The generated clients live in `src/prisma/js-client` and `src/prisma-app-logs/js-client`
// (imported by relative path, with or without `/index`); `@prisma/client` and its runtime entry
// points expose the same classes.
const CLIENT_MODULE =
  /(^|\/)js-client(\/index(\.js|\.ts)?|\/runtime\/[\w.-]+)?$|^@prisma\/client(\/.*)?$|^\.prisma\/client(\/.*)?$/;

/** @param {string | null} source module specifier */
export function isPrismaClientModule(source) {
  return typeof source === 'string' && CLIENT_MODULE.test(source);
}
