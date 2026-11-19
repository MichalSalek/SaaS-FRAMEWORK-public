

'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');


const SESSION_RE =
  /\b(?:[Ss]\d{2,3}[a-z]?|MR\d{2,4}|PLAN-[A-Z][A-Z0-9-]+|FWE(?:\s+(?:Wave|Tier)\s+[A-Z0-9]+)?|BDX|FDX|TQM)\b/g;
// Bans on discussing a decision again.
const BAN_RE =
  /\b(?:do\s+not\s+re-?(?:review|raise|open|visit|litigate|debate)|don'?t\s+re-?(?:review|raise|open|visit)|not\s+up\s+for\s+(?:debate|discussion)|topic\s+closed|closed\s+discussion|nie\s+(?:wracać|otwierać|podważać))\b/gi;


const OWNER_DATE_RE = /\bowner(?:'s)?(?:\s+(?:decision|vote|report|directive|choice))?[ ,]*\(?\d{4}-\d{2}-\d{2}/gi;
const RULES = [
  ['SESSION', SESSION_RE],
  ['BAN', BAN_RE],
  ['OWNERDATE', OWNER_DATE_RE],
];
const ALLOW_RE = /comment-policy-allow:\s*\S/;

// Polish prose in a comment: a Polish letter plus two Polish function words, outside quotes
// (quoted product copy such as „Zacznij za darmo” is a citation, not the comment's language).
const PL_WORDS = /(?:^|[^\p{L}])(nie|się|jest|są|że|już|tylko|przez|który|która|które|żeby|oraz|albo|lub|gdy|jeśli|bo|tak|tu|ten|ta|to|dla|na|do|po|od|przy|jak|czy|ale|więc|bez|ma|mamy|można|trzeba|tego|tej|jego|jej)(?=$|[^\p{L}])/giu;
const isPolishProse = line => {
  const bare = line.replace(/„[^”"]*[”"]|"[^"]*"|“[^”]*”|«[^»]*»|`[^`]*`|'[^']*'/g, ' ');
  if (!/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(bare)) return false;
  return (bare.match(PL_WORDS) || []).length >= 2;
};

const TS_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const CSS_EXT = /\.css$/;
const HASH_EXT = /\.(sh|py)$/;
const PRISMA_EXT = /\.prisma$/;

/** @returns {Array<[number, number]>} comment [start, end) ranges */
function tsComments(file, text) {
  const kind = /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : /\.(js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  const seen = new Map();
  const jsxText = [];
  const add = ranges => {
    for (const r of ranges || []) seen.set(r.pos, r.end);
  };
  const visit = node => {
    if (node.kind === ts.SyntaxKind.JsxText) jsxText.push([node.pos, node.end]);
    else {
      add(ts.getLeadingCommentRanges(text, node.pos));
      add(ts.getTrailingCommentRanges(text, node.end));
    }
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  // Shebang is not a comment.
  // Text of a JSX element is content, not trivia, even when it looks like `// ...`.
  return [...seen.entries()].filter(
    ([s]) => !(s === 0 && text.startsWith('#!')) && !jsxText.some(([a, b]) => s >= a && s < b)
  );
}

function cssComments(text) {
  const out = [];
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 2;
      else {
        if (c === quote) quote = null;
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out.push([i, stop]);
      i = stop;
      continue;
    }
    i++;
  }
  return out;
}

/** Whole-line comments only (`# x`, `// x`): an inline tail after code is never a block line. */
function lineComments(text, marker, skipHeredoc) {
  const out = [];
  const lines = text.split('\n');
  let offset = 0;
  let heredoc = null;
  lines.forEach((line, idx) => {
    if (heredoc) {
      if (line.replace(/^\t+/, '') === heredoc) heredoc = null;
    } else {
      const trimmed = line.trimStart();
      if (trimmed.startsWith(marker) && !(idx === 0 && trimmed.startsWith('#!'))) {
        const start = offset + line.indexOf(marker);
        out.push([start, offset + line.length]);
      } else if (skipHeredoc) {
        const m = line.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
        if (m && !/<<</.test(line)) heredoc = m[1];
      }
    }
    offset += line.length + 1;
  });
  return out;
}

function langOf(file, text) {
  if (TS_EXT.test(file) && !/\.d\.ts$/.test(file)) return 'ts';
  if (/\.d\.ts$/.test(file)) return 'ts';
  if (CSS_EXT.test(file)) return 'css';
  if (HASH_EXT.test(file)) return 'hash';
  if (PRISMA_EXT.test(file)) return 'prisma';
  if (!path.extname(file) && /^#!.*\b(ba)?sh\b/.test(text)) return 'hash';
  if (!path.extname(file) && /^#!.*\bnode\b/.test(text)) return 'ts';
  return null;
}

function commentRanges(file, text, lang) {
  if (lang === 'ts') {
    if (!TS_EXT.test(file)) {
      // Extensionless node script: drop the shebang line so the parser accepts it.
      return tsComments(file + '.js', text);
    }
    return tsComments(file, text);
  }
  if (lang === 'css') return cssComments(text);
  if (lang === 'hash') return lineComments(text, '#', /\.sh$|^[^.]*$/.test(path.basename(file)));
  if (lang === 'prisma') return lineComments(text, '//', false);
  return [];
}

/**
 * Policy records for one source file, using the lexer above. `null` when the
 * file has no comment language. A parse failure is `{ error }` and no records.
 * @returns {{ records: Array<{tag: string, line: number, text: string}>, blocks: number, commentLines: number, maxBlock: number, ranges: Array<[number, number]>, error?: string } | null}
 */
function evaluatePolicy(rel, text, limit) {
  const lang = langOf(rel, text);
  if (!lang) return null;
  let ranges;
  try {
    ranges = commentRanges(rel, text, lang);
  } catch (err) {
    return {
      error: err.message,
      records: [],
      blocks: 0,
      commentLines: 0,
      maxBlock: 0,
      ranges: [],
    };
  }
  const records = [];
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = pos => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const mask = new Uint8Array(text.length);
  for (const [s, e] of ranges) mask.fill(1, s, e);
  const isCommentLine = new Array(starts.length).fill(false);
  for (let l = 0; l < starts.length; l++) {
    const s = starts[l];
    const e = l + 1 < starts.length ? starts[l + 1] - 1 : text.length;
    let hasComment = false;
    let hasCode = false;
    for (let i = s; i < e; i++) {
      if (mask[i]) hasComment = true;
      else if (!/\s/.test(text[i])) {
        hasCode = true;
        break;
      }
    }
    // An empty line inside a block comment belongs to the block (its line break is masked).
    if (!hasCode && !hasComment && s > 0 && mask[s - 1]) hasComment = true;
    isCommentLine[l] = hasComment && !hasCode;
  }
  let commentLines = 0;
  let blocks = 0;
  let maxBlock = 0;
  let run = 0;
  for (let l = 0; l <= starts.length; l++) {
    if (l < starts.length && isCommentLine[l]) {
      run++;
      commentLines++;
      continue;
    }
    if (run > 0) {
      blocks++;
      maxBlock = Math.max(maxBlock, run);
      const blockText = text.slice(starts[l - run], l < starts.length ? starts[l] : text.length);
      if (run > limit && !ALLOW_RE.test(blockText)) {
        records.push({ tag: 'BLOCK', line: l - run + 1, text: String(run) });
      }
    }
    run = 0;
  }
  for (const [s, e] of ranges) {
    const firstLine = lineOf(s);
    text
      .slice(s, e)
      .split('\n')
      .forEach((part, i) => {
        const line = firstLine + i + 1;
        const lineText = text.slice(starts[line - 1], (starts[line] ?? text.length + 1) - 1);
        if (ALLOW_RE.test(lineText)) return;
        for (const [tag, re] of RULES) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(part))) records.push({ tag, line, text: m[0] });
        }
        if (isPolishProse(part)) {
          records.push({ tag: 'POLISH', line, text: part.trim().slice(0, 80) });
        }
      });
  }
  return { records, blocks, commentLines, maxBlock, ranges };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const root = args[0];
  const limitIdx = args.indexOf('--limit');
  const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 15;
  if (!root) {
    console.error('usage: comment-scan.cjs <root> [--limit 15] < NUL-separated paths');
    process.exit(2);
  }
  const input = fs.readFileSync(0, 'utf8').split('\0').filter(Boolean);
  let files = 0;
  let commentLines = 0;
  let blocks = 0;
  let maxBlock = 0;
  for (const rel of input) {
    const abs = path.join(root, rel);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!langOf(rel, text)) continue;
    files++;
    const result = evaluatePolicy(rel, text, LIMIT);
    if (!result) continue;
    if (result.error) {
      console.error(`PARSE-ERROR\t${rel}\t${result.error}`);
      process.exitCode = 3;
      continue;
    }
    commentLines += result.commentLines;
    blocks += result.blocks;
    maxBlock = Math.max(maxBlock, result.maxBlock);
    for (const rec of result.records) {
      console.log(`${rec.tag}\t${rel}\t${rec.line}\t${rec.text}`);
    }
  }
  console.log(`STAT\t${files}\t${commentLines}\t${blocks}\t${maxBlock}`);
}

module.exports = {
  langOf,
  commentRanges,
  isPolishProse,
  evaluatePolicy,
};
