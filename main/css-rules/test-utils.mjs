// Test helper for `rules/*.test.mjs`: run one rule over an in-memory tree.
import { runCssRules } from './engine.mjs';

/**
 * @param {any} rule
 * @param {Record<string, string>} files rel path → CSS text
 * @param {{ measured?: boolean }} [options] measured: apply the presence floor
 */
export function lintCss(rule, files, options = {}) {
  const fileMap = new Map(Object.entries(files));
  return runCssRules({
    rules: [rule],
    cwd: '/virtual',
    fileMap,
    only: options.measured ? undefined : [...fileMap.keys()],
  });
}
