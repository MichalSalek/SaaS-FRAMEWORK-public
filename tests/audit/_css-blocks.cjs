/**
 * Shared CSS block parser for the theme guards.
 *
 * Several guards counted braces PER LINE, so a block written on ONE line (`opens === closes`)
 * never reached the stack or any block body: invisible to the guard, although the same code
 * split over lines failed. That gave false green in `disabled-text-contrast` and `no-split-bg`
 * and false RED in `section-discipline` (the allowed `.page`/`.hero` slot never matched).
 *
 * This is the character parser of `edge-stripe-discipline` lifted into ONE source so a fourth
 * copy cannot drift. It is aware of comments and strings: a brace in `content: '}'` does not
 * close a rule and a CSS comment adds no structure.
 *
 * Returns blocks as `{ head, body, start, ancestors }`: `start` is the line of the opening brace,
 * `ancestors` the enclosing blocks (media, nesting) from the outside in.
 */
function parseBlocks(text) {
  const blocks = [];
  const stack = [];
  const n = text.length;
  let i = 0;
  let headStart = 0;
  // Line numbers come from a precomputed offset table plus binary search: scanning the text from
  // zero for EVERY brace was quadratic and cost more than the whole scan on large sheets.
  const lineStarts = [];
  for (let k = 0; k < n; k++) if (text[k] === '\n') lineStarts.push(k);
  const lineOf = idx => {
    let lo = 0;
    let hi = lineStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] < idx) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < n && text[i] !== q) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '{') {
      stack.push({
        head: text.slice(headStart, i),
        start: lineOf(i),
        bodyStart: i + 1,
      });
      headStart = i + 1;
      i++;
      continue;
    }
    if (c === '}') {
      const b = stack.pop();
      if (b) {
        b.body = text.slice(b.bodyStart, i);
        b.ancestors = stack.slice();
        blocks.push(b);
      }
      headStart = i + 1;
      i++;
      continue;
    }
    if (c === ';' && stack.length === 0) headStart = i + 1;
    i++;
  }
  return blocks;
}

/**
 * Block head WITHOUT comments. `head` is the raw slice from the end of the previous declaration
 * to the brace, so it swallows comments standing above the rule (often long section frames) and
 * would break every selector match.
 */
function selectorOf(block) {
  return String(block.head || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
}

module.exports = { parseBlocks, selectorOf };
