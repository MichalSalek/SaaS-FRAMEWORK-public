// CSS guard rules, discovered from `rules/*.mjs` (never a hand-kept list; see engine.mjs).
// `rules/_*.mjs` are helpers shared by rules, not rules.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RULES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rules');

export const CSS_RULES = await Promise.all(
  readdirSync(RULES_DIR)
    .filter(file => file.endsWith('.mjs') && !file.endsWith('.test.mjs') && !file.startsWith('_'))
    .sort()
    .map(async file => {
      const rule = (await import(pathToFileURL(path.join(RULES_DIR, file)).href)).default;
      if (!rule || `${rule.name}.mjs` !== file) {
        throw new Error(`css-rules/rules/${file}: default export must be a rule named after the file`);
      }
      return rule;
    })
);
