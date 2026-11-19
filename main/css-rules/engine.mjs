

import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

/**
 * True when a comment holding `<marker>: <reason>` sits on the node's line or up to `above` lines
 * above it. A bare marker without a reason does not count.
 * @param {import('postcss').Node} node
 * @param {string} marker e.g. 'ch-allow'
 * @param {number} [above]
 */
export function hasAllowMarker(node, marker, above = 2) {
  const line = node.source?.start?.line ?? 0;
  const root = node.root();
  let allowed = false;
  const pattern = new RegExp(
    `${marker.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}:\\s*[^\\s*/]`
  );
  root.walkComments(comment => {
    const start = comment.source?.start?.line ?? -1;
    const end = comment.source?.end?.line ?? start;
    if (end >= line - above && start <= line && pattern.test(comment.text)) {
      allowed = true;
      return false;
    }
    return undefined;
  });
  return allowed;
}

/**
 * Runs rules over a workspace (or over an in-memory file map, for tests).
 * @param {object} args
 * @param {any[]} args.rules
 * @param {string} args.cwd                 workspace root
 * @param {Map<string,string>} [args.fileMap] rel path → CSS text; replaces the disk entirely
 * @param {string[]} [args.only]            lint only these rel paths (no floors)
 */
export function runCssRules({ rules, cwd, fileMap, only }) {
  const findings = [];
  const errors = [];
  const sites = new Map();
  const measured = !only;
  const exists = rel =>
    fileMap ? fileMap.has(rel) : existsSync(path.join(cwd, rel));
  const read = rel =>
    fileMap ? fileMap.get(rel) : readFileSync(path.join(cwd, rel), 'utf8');
  const parsed = new Map();
  const parse = rel => {
    if (!parsed.has(rel)) {
      parsed.set(rel, postcss.parse(read(rel), { from: rel }));
    }
    return parsed.get(rel);
  };

  for (const rule of rules) {
    const ctx = {
      rule: rule.name,
      cwd,
      file: '',
      exists,
      read,
      parse,
      site() {
        sites.set(rule.name, (sites.get(rule.name) ?? 0) + 1);
      },
      report(node, message, file) {
        findings.push({
          rule: rule.name,
          file: file ?? ctx.file,
          line: node?.source?.start?.line ?? 0,
          message,
        });
      },
      error(message) {
        errors.push(`css/${rule.name}: ${message}`);
      },
    };
    for (const rel of rule.paths ?? []) {
      if (!exists(rel)) {
        ctx.error(`path named by the rule does not exist: ${rel}`);
      }
    }
    let files;
    if (fileMap) {
      files = [...fileMap.keys()].filter(
        rel =>
          matchesAny(rel, rule.files) && !matchesAny(rel, rule.ignores ?? [])
      );
    } else {
      files = rule.files
        .flatMap(pattern =>
          globSync(pattern, { cwd, exclude: rule.ignores ?? [] })
        )
        .map(rel => rel.split(path.sep).join('/'));
      files = [...new Set(files)].sort();
    }
    if (only) {
      const wanted = new Set(only);
      files = files.filter(rel => wanted.has(rel));
    }
    rule.setup?.(ctx);
    for (const rel of files) {
      ctx.file = rel;
      rule.check(parse(rel), ctx);
    }
    ctx.file = '';
    rule.finish?.(ctx);
    const count = sites.get(rule.name) ?? 0;
    if (measured && count < rule.presence.minSites) {
      ctx.error(
        `inspected ${count} sites, floor is ${rule.presence.minSites} (${rule.presence.what}). The anchor moved or the root is wrong.`
      );
    }
  }
  return { findings, errors, sites };
}

/** Minimal glob matcher for in-memory runs: `**`, `*`, `{a,b}`. */
export function matchesAny(rel, patterns) {
  return patterns.some(pattern => globToRegExp(pattern).test(rel));
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:/)?';
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '{') {
      const close = glob.indexOf('}', i);
      re += `(?:${glob
        .slice(i + 1, close)
        .split(',')
        .map(escape)
        .join('|')})`;
      i = close;
    } else {
      re += escape(c);
    }
  }
  return new RegExp(`^${re}$`);
}

function escape(text) {
  return text.replace(/[.+^$()|[\]\\?]/g, '\\$&');
}
