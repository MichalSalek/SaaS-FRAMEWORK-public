#!/usr/bin/env node
/**
 * qa-alignment-probe — measures what an eye catches and a diff does not.
 *
 * Owner, 2026-10-08: „ikonka jest mega wyżej od samego tekstu … MUSISZ takie
 * rzeczy dopracowywać”, „Kolory (min 1, TUTAJ SPADA max 3)”. Four classes,
 * each measured in the DOM of the live dev app, per screen and width:
 *
 *   ICON   an icon and the text beside it are not on one line: the icon's
 *          vertical centre is more than 2 px away from the centre of the
 *          text's FIRST line.
 *   BREAK  an unbreakable piece broke across lines: a parenthesised hint, a
 *          counter „2/5”, a number with its unit or currency, a date.
 *   CUT    text is really cut with an ellipsis (scrollWidth > clientWidth).
 *          Free text written by a person (a message preview, a note) is
 *          exempt when its element carries `data-truncate="content"`.
 *   DOT    a middle dot „·” is rendered as punctuation.
 *
 * Usage:  node scripts/qa-alignment-probe.cjs [--width 360,390] [--only <regex>]
 *                                             [--locale pl|en|de] [--json out.json]
 * Needs the dev stack (front :3000, back :3001) and the seeded demo accounts.
 * Exit 1 when anything is found, so it can gate a wave.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

const FRONT = process.env.BASE_URL || 'http://localhost:3000';
const BACK = process.env.BACKEND_URL || 'http://localhost:3001';
const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const WIDTHS = (arg('width') || '360,390').split(',').map(Number);
const ONLY = arg('only') ? new RegExp(arg('only')) : null;
const LOCALE = arg('locale') || 'pl';
const JSON_OUT = arg('json');

const EMAILS = {
  stylist: 'demo-stylist-main@example.com',
  stylistfree: 'test-stylist-main@example.com',
  client: 'demo-client-main@example.com',
  admin: 'test-admin-main@example.com',
};

/** [name, route, role]. Public pages use role null. */
const PAGES = [
  ['st-dashboard', '/app', 'stylist'],
  ['st-gallery', '/app/gallery', 'stylist'],
  ['st-upload', '/app/gallery/upload-asset', 'stylist'],
  ['st-pairing', '/app/pairing', 'stylist'],
  ['st-clients', '/app/clients', 'stylist'],
  ['st-shared', '/app/shared', 'stylist'],
  ['st-messages', '/app/messages', 'stylist'],
  ['st-profile', '/app/profile', 'stylist'],
  ['st-salon-staff', '/app/salon/staff', 'stylist'],
  ['st-salon-invitations', '/app/salon/invitations', 'stylist'],
  ['st-account', '/app/user/account', 'stylist'],
  ['st-account-account', '/app/user/account/account', 'stylist'],
  ['st-account-notifications', '/app/user/account/notifications', 'stylist'],
  ['st-account-appearance', '/app/user/account/appearance', 'stylist'],
  ['st-account-activity', '/app/user/account/activity', 'stylist'],
  ['st-account-security', '/app/user/account/security', 'stylist'],
  ['st-account-data', '/app/user/account/data', 'stylist'],
  ['st-account-danger', '/app/user/account/danger', 'stylist'],
  ['st-pay', '/app/user/account/pay', 'stylist'],
  ['st-support', '/app/user/support', 'stylist'],
  ['st-support-new', '/app/user/support/new', 'stylist'],
  ['st-support-threads', '/app/user/support/threads', 'stylist'],
  ['st-activate-client', '/app/user/activate-client', 'stylist'],
  ['st-delete-self', '/app/user/delete-self', 'stylist'],
  ['sf-dashboard', '/app', 'stylistfree'],
  ['sf-gallery', '/app/gallery', 'stylistfree'],
  ['sf-pairing', '/app/pairing', 'stylistfree'],
  ['sf-clients', '/app/clients', 'stylistfree'],
  ['sf-shared', '/app/shared', 'stylistfree'],
  ['sf-messages', '/app/messages', 'stylistfree'],
  ['sf-pay', '/app/user/account/pay', 'stylistfree'],
  ['sf-salon-staff', '/app/salon/staff', 'stylistfree'],
  ['cl-dashboard', '/app', 'client'],
  ['cl-sessions', '/app/sessions', 'client'],
  ['cl-favorites', '/app/favorites', 'client'],
  ['cl-pairing', '/app/pairing', 'client'],
  ['cl-messages', '/app/messages', 'client'],
  ['cl-client-profile', '/app/client-profile', 'client'],
  ['cl-account', '/app/user/account', 'client'],
  ['cl-activate-stylist', '/app/user/activate-stylist', 'client'],
  ['ad-dashboard', '/app/admin', 'admin'],
  ['ad-logs', '/app/admin/logs', 'admin'],
  ['ad-users', '/app/admin/users', 'admin'],
  ['ad-support', '/app/admin/support', 'admin'],
  ['ad-health', '/app/admin/health', 'admin'],
  ['ad-audit', '/app/admin/audit', 'admin'],
  ['ad-crawlers', '/app/admin/ai-crawlers', 'admin'],
  ['ad-notes', '/app/admin/notes', 'admin'],
  ['ad-policies', '/app/admin/policies', 'admin'],
  ['ad-announcements', '/app/admin/announcements', 'admin'],
  ['ad-reports', '/app/admin/reports', 'admin'],
  ['ad-moderation', '/app/admin/moderation', 'admin'],
  ['ad-email-schedule', '/app/admin/email-schedule', 'admin'],
  ['ad-email-preview', '/app/admin/email-preview', 'admin'],
  ['ad-permissions', '/app/admin/permissions', 'admin'],
  ['ad-colors', '/app/admin/colors-traits', 'admin'],
  ['ad-flags', '/app/admin/feature-flags', 'admin'],
  ['ad-config', '/app/admin/config', 'admin'],
  ['pub-profile', '/stylist/velvet-nails', null],
  ['pub-login', '/user/login', null],
  ['pub-welcome', '/welcome', null],
  ['pub-get-app', '/get-app', null],
];

const tokens = {};
async function token(role) {
  if (tokens[role]) return tokens[role];
  const res = await fetch(`${BACK}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: FRONT },
    body: JSON.stringify({ email: EMAILS[role] }),
  });
  const value = res.headers.get('authorization');
  if (!value) throw new Error(`no token for ${role}: ${res.status}`);
  return (tokens[role] = value);
}

/** Runs in the page. Returns findings as plain objects. */
function measure() {
  const out = [];
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (Number(getComputedStyle(n).opacity) < 0.05) return false;
    }
    return true;
  };
  const where = el => {
    const parts = [];
    for (let n = el; n && parts.length < 3 && n !== document.body; n = n.parentElement) {
      const cls = (n.getAttribute('class') || '').split(/\s+/).filter(Boolean)[0] || '';
      // CSS-module names read `File-module__hash__class`: keep file and class.
      const m = cls.match(/^([A-Za-z0-9]+)-module__[^_]+__(.+)$/);
      parts.unshift(m ? `${m[1]}.${m[2]}` : cls || n.tagName.toLowerCase());
    }
    return parts.join(' > ');
  };
  /** Rect of the first rendered line of a text node. */
  const firstLine = node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
    return rects.length ? rects[0] : null;
  };
  const textNodesOf = root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue && n.nodeValue.trim().length > 1 && n.parentElement && visible(n.parentElement)) nodes.push(n);
    }
    return nodes;
  };

  // ── ICON: an svg and the text that shares its row ──────────────────────
  const seenIcon = new Set();
  for (const svg of document.querySelectorAll('svg')) {
    if (!visible(svg)) continue;
    const box = svg.getBoundingClientRect();
    if (box.width > 40 || box.height > 40) continue; // an illustration, a QR
    // A placeholder glyph inside an avatar is a portrait, not an icon beside a label.
    if (svg.closest('[class*="vatar"]')) continue;
    // The row: the nearest ancestor that also holds text outside the svg's branch.
    let branch = svg;
    let row = svg.parentElement;
    let text = null;
    for (let depth = 0; row && depth < 4 && !text; depth++) {
      const cs = getComputedStyle(row);
      const isRowLayout = /flex|grid/.test(cs.display) && !/column/.test(cs.flexDirection);
      if (isRowLayout) {
        for (const node of textNodesOf(row)) {
          if (branch.contains(node)) continue;
          const line = firstLine(node);
          if (!line) continue;
          // Beside the icon, not under it: horizontally apart, vertically near.
          const apart = line.left >= box.right - 1 || line.right <= box.left + 1;
          if (apart && Math.abs(line.top - box.top) < 60) {
            text = { node, line };
            break;
          }
        }
      }
      if (!text) {
        // The icon is STACKED over its own label (a tab, a tile): the ancestor
        // already holds text and lays it out in a column. Its neighbours'
        // labels are not this icon's text.
        const stacked =
          /flex|grid/.test(cs.display) &&
          /column/.test(cs.flexDirection) &&
          textNodesOf(row).some(node => !branch.contains(node));
        if (stacked) break;
        branch = row;
        row = row.parentElement;
      }
    }
    if (!text || !row) continue;
    const gap = Math.min(Math.abs(text.line.left - box.right), Math.abs(box.left - text.line.right));
    if (gap > 28) continue; // unrelated neighbours (a trailing control far away)
    const delta = box.top + box.height / 2 - (text.line.top + text.line.height / 2);
    if (Math.abs(delta) <= 2) continue;
    // A list row with a label AND a description centres its leading icon on
    // the whole text block (the phone-settings convention): that is aligned.
    let column = text.node.parentElement;
    while (column && column.parentElement !== row && row.contains(column.parentElement)) {
      column = column.parentElement;
    }
    if (column && column !== row) {
      const block = column.getBoundingClientRect();
      const lines = Math.round(block.height / text.line.height);
      const blockDelta = box.top + box.height / 2 - (block.top + block.height / 2);
      const centredOnBlock = lines >= 2 && Math.abs(blockDelta) <= 2;
      // …and so does a TRAILING control (an accordion caret, a row chevron):
      // it belongs to the row, not to the first line. A LEADING icon beside
      // one wrapped title is the defect: it must sit on the first line.
      const trailing = box.left >= text.line.right - 1;
      if (centredOnBlock && (column.children.length >= 2 || trailing)) continue;
    }
    const key = where(row) + '|' + text.node.nodeValue.trim().slice(0, 24);
    if (seenIcon.has(key)) continue;
    seenIcon.add(key);
    out.push({
      kind: 'ICON',
      delta: Math.round(delta * 10) / 10,
      text: text.node.nodeValue.trim().slice(0, 48),
      at: where(row),
    });
  }

  // ── BREAK: an unbreakable piece on two lines ───────────────────────────
  const PIECES = [
    /\([^()]{2,40}\)/g, // (min 1, max 3)
    /\d+\s?\/\s?\d+(?:\s\p{L}+)?/gu, // 2/5 wybranych
    /\d{1,2}\s\p{L}{3,12}\.?\s\d{4}/gu, // 15 wrz 2026
    /\d[\d\s.,]*\s?(?:zł|PLN|EUR|€|%|MB|px|dni|min)\b/gu, // 79 zł, 10 MB
  ];
  const seenBreak = new Set();
  for (const node of textNodesOf(document.body)) {
    // Free text (a message, a note, a log line) breaks where it must: the
    // rule is about the interface's own hints, counters and dates.
    if (node.parentElement?.closest('[data-truncate="content"]')) continue;
    const value = node.nodeValue;
    for (const re of PIECES) {
      re.lastIndex = 0;
      for (let m = re.exec(value); m; m = re.exec(value)) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const tops = new Set([...range.getClientRects()].filter(r => r.width > 0.5).map(r => Math.round(r.top)));
        if (tops.size > 1) {
          const key = where(node.parentElement) + '|' + m[0];
          if (!seenBreak.has(key)) {
            seenBreak.add(key);
            out.push({ kind: 'BREAK', text: m[0], at: where(node.parentElement) });
          }
        }
      }
    }
  }

  // ── CUT: a real ellipsis ───────────────────────────────────────────────
  const seenCut = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.children.length > 2) continue;
    // Visually hidden text (the 1px clip of a screen-reader label) is not cut.
    const size = el.getBoundingClientRect();
    if (size.width <= 2 || size.height <= 2) continue;
    // Free text written by a person (a message preview, a note) may be
    // clamped on purpose; the element says so. A label or a name may not.
    if (el.closest('[data-truncate="content"]')) continue;
    const cs = getComputedStyle(el);
    const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    const cutX = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
    const cutY = clamped && el.scrollHeight > el.clientHeight + 1;
    if (!cutX && !cutY) continue;
    const text = (el.textContent || '').trim();
    if (text.length < 3) continue;
    const key = where(el) + '|' + text.slice(0, 24);
    if (seenCut.has(key)) continue;
    seenCut.add(key);
    out.push({ kind: 'CUT', text: text.slice(0, 60), at: where(el) });
  }

  // ── DOT: a rendered middle dot ─────────────────────────────────────────
  const seenDot = new Set();
  for (const node of textNodesOf(document.body)) {
    if (node.nodeValue.includes('·')) {
      const key = node.nodeValue.trim().slice(0, 40);
      if (!seenDot.has(key)) {
        seenDot.add(key);
        out.push({ kind: 'DOT', text: key, at: where(node.parentElement) });
      }
    }
  }
  for (const el of document.querySelectorAll('body *')) {
    for (const pseudo of ['::before', '::after']) {
      const content = getComputedStyle(el, pseudo).content;
      if (content && content.includes('·') && visible(el)) {
        const key = where(el) + pseudo;
        if (!seenDot.has(key)) {
          seenDot.add(key);
          out.push({ kind: 'DOT', text: `${pseudo} „·”`, at: where(el) });
        }
      }
    }
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const pages = PAGES.filter(([name]) => !ONLY || ONLY.test(name));
  for (const width of WIDTHS) {
    const contexts = {};
    for (const [name, route, role] of pages) {
      const key = role || 'public';
      if (!contexts[key]) {
        const ctx = await browser.newContext({
          viewport: { width, height: width >= 1024 ? 900 : 844 },
          isMobile: width < 500,
          hasTouch: width < 500,
        });
        const t = role ? await token(role) : null;
        await ctx.addInitScript(
          ({ value }) => {
            if (value) localStorage.setItem('authorization', value);
            localStorage.setItem(
              'cookie-consent-v1',
              JSON.stringify({ state: { consent: { analytics: false, marketing: false } }, version: 0 })
            );
          },
          { value: t }
        );
        contexts[key] = ctx;
      }
      const page = await contexts[key].newPage();
      try {
        await page.goto(`${FRONT}/${LOCALE}${route}`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(3500);
        const findings = await page.evaluate(measure);
        for (const finding of findings) results.push({ page: name, width, ...finding });
        process.stderr.write(`${name}@${width}: ${findings.length}\n`);
      } catch (error) {
        results.push({ page: name, width, kind: 'ERROR', text: String(error).slice(0, 120), at: '' });
      }
      await page.close();
    }
    for (const ctx of Object.values(contexts)) await ctx.close();
  }
  await browser.close();

  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
  // One line per distinct finding (the same defect on two widths prints once).
  const lines = new Map();
  for (const r of results) {
    const id = `${r.kind}\t${r.at}\t${r.text}`;
    const entry = lines.get(id) || { ...r, pages: new Set(), widths: new Set() };
    entry.pages.add(r.page);
    entry.widths.add(r.width);
    lines.set(id, entry);
  }
  const byKind = {};
  for (const entry of lines.values()) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
    const extra = entry.kind === 'ICON' ? ` (${entry.delta > 0 ? 'icon lower' : 'icon higher'} by ${Math.abs(entry.delta)}px)` : '';
    console.log(
      `${entry.kind}\t${[...entry.pages].slice(0, 3).join(',')}${entry.pages.size > 3 ? ',…' : ''}\t@${[...entry.widths].join('/')}\t„${entry.text}”${extra}\t${entry.at}`
    );
  }
  console.error(`\n${lines.size} distinct finding(s): ${JSON.stringify(byKind)}`);
  process.exit(lines.size > 0 ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(2);
});
