// Reads hashed build CSS for <InlineCssHead> in pages/_document.tsx
// (DECISION there).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Route PATTERNS (`__NEXT_DATA__.page`) that keep Next's <link> stylesheets.
// The logged-in app is opened again and again (and inside the native shell),
// so its CSS is worth caching as files; public pages are mostly a first visit.
const LINKED_CSS_ROUTE_PREFIXES = ['/app', '/dev'] as const;

export function inlinesCssForPage(page: string): boolean {
  return !LINKED_CSS_ROUTE_PREFIXES.some(
    prefix => page === prefix || page.startsWith(`${prefix}/`)
  );
}

// Hashed build files never change under the same name, so one read per
// process is enough. `null` = unreadable, the page falls back to a <link>.
const cssTextCache = new Map<string, string | null>();

export function readBuildCss(file: string): string | null {
  const cached = cssTextCache.get(file);
  if (cached !== undefined) {
    return cached;
  }
  let text: string | null = null;
  try {
    // `next build` prerenders with the project as cwd, and the standalone
    // server chdirs next to its own `.next` (static files copied by the deploy).
    text = readFileSync(join(process.cwd(), '.next', file), 'utf8');
    // A closing tag inside the CSS would end the <style> element early.
    if (text.toLowerCase().includes('</style')) {
      text = null;
    }
  } catch {
    text = null;
  }
  cssTextCache.set(file, text);
  return text;
}
