// UI/features/account/helpers/session-user-agent.helper.ts
// Pure: session User-Agent → human browser label for the "devices" list.
//
// DECISION: rule ORDER matters. Edge, Opera and Samsung Internet also carry "Chrome/…" (and
// "Safari/…") in the UA, and Chrome on iOS carries "Safari/…"; the old regex took the first hit of
// (Chrome|Firefox|Safari|Edge|Opera), so Edge and Opera looked like Chrome and Safari showed the
// WebKit engine number (605.1.15) instead of the browser version, which sits in "Version/…".
// Chromium-based variants first, then Firefox, Chrome, and Safari last. Version = the major number:
// a reduced UA has zeros in the rest anyway ("124.0.0.0").

type BrowserRule = {
  name: string;
  pattern: RegExp;
};

const BROWSER_RULES: readonly BrowserRule[] = [
  { name: 'Edge', pattern: /\bEdg(?:e|A|iOS)?\/(\d+)/ },
  { name: 'Opera', pattern: /\b(?:OPR|OPiOS)\/(\d+)|\bOpera[\s/](\d+)/ },
  { name: 'Samsung Internet', pattern: /\bSamsungBrowser\/(\d+)/ },
  { name: 'Firefox', pattern: /\b(?:Firefox|FxiOS)\/(\d+)/ },
  { name: 'Chrome', pattern: /\b(?:Chrome|CriOS)\/(\d+)/ },
  { name: 'Safari', pattern: /\bVersion\/(\d+)(?:[\d.]*)\s.*\bSafari\// },
];

/** "Chrome 124", "Safari 17", … or null when the UA is not a known browser. */
export function parseSessionBrowser(userAgent: string): string | null {
  for (const rule of BROWSER_RULES) {
    const match = rule.pattern.exec(userAgent);
    if (match) {
      const version = match.slice(1).find(v => v !== undefined);
      return version ? `${rule.name} ${version}` : rule.name;
    }
  }
  return null;
}

// System rules, most specific first: an iPhone UA says „like Mac OS X” and an
// Android UA says „Linux”, so the phone systems must be tried before the
// desktop ones.
const OS_RULES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'iOS', pattern: /\b(?:iPhone|iPad|iPod)\b/ },
  { name: 'Android', pattern: /\bAndroid\b/ },
  { name: 'Windows', pattern: /\bWindows\b/ },
  { name: 'ChromeOS', pattern: /\bCrOS\b/ },
  { name: 'macOS', pattern: /\bMac OS X\b|\bMacintosh\b/ },
  { name: 'Linux', pattern: /\bLinux\b/ },
];

/** "Windows", "Android", … or null when the UA names no known system. */
export function parseSessionOs(userAgent: string): string | null {
  return OS_RULES.find(rule => rule.pattern.test(userAgent))?.name ?? null;
}

/**
 * The best name a session row can carry: "Chrome 124, Windows", or the one
 * half that is known. Null when the UA is missing or tells nothing: the caller
 * then names the row by its sign-in date, never by one word repeated on every
 * row („Nieznane” a hundred times, owner).
 */
export function describeSessionDevice(
  userAgent: string | null | undefined
): string | null {
  if (userAgent === null || userAgent === undefined || userAgent === '') {
    return null;
  }
  const parts = [parseSessionBrowser(userAgent), parseSessionOs(userAgent)];
  const known = parts.filter((part): part is string => part !== null);
  return known.length > 0 ? known.join(', ') : null;
}
