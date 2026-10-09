// Auto-assigned public profile address for a freshly onboarded stylist.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-09-23:
// The sales pitch promises "your own page with a link for your Instagram bio",
// but a new stylist had NO shareable link until she invented one herself in
// /app/profile (the share card showed only "Ustaw własny link"). Onboarding now
// derives an address from the display name (`Anna Kowalska` -> `anna-kowalska`,
// `-2`..`-9` on collision, then a short random tail). It stays editable in
// /app/profile. Assignment is BEST-EFFORT and runs AFTER the onboarding
// transaction: `vanity_url` is @unique, so a race with another claimant must
// never roll back account creation. Existing accounts are not backfilled.
// Source order (owner 2026-09-23): the Instagram account name first, because
// that is the name her clients already know (`@anna.nails_waw` ->
// `anna-nails-waw`); the display name when she gave no handle.
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { hasCode } from '@kernel/models/type_narrowing';
import { RESERVED_VANITY_URLS } from '@kernel/domain/user-and-account/vanity-url.config';
import {
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
} from '@kernel/policies/validation.config';

/** Room kept for a `-NNNN` collision suffix under VANITY_URL_MAX. */
const SUFFIX_ROOM = 5;
const NUMBERED_SUFFIXES = [2, 3, 4, 5, 6, 7, 8, 9] as const;

// NFD strips most diacritics; these letters have no decomposition.
const LETTER_MAP: Readonly<Record<string, string>> = {
  ł: 'l',
  ß: 'ss',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
};

/**
 * Pure: display name -> vanity base (`[a-z0-9-]`, VANITY_URL_MIN..MAX minus
 * suffix room), or null when nothing usable is left (e.g. only emoji).
 */
export function slugifyVanityBase(displayName: string | null): string | null {
  if (!displayName) {
    return null;
  }
  const slug = displayName
    .toLowerCase()
    .replace(/[łßøæœ]/g, ch => LETTER_MAP[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, VALIDATION_LENGTHS.VANITY_URL_MAX - SUFFIX_ROOM)
    .replace(/-+$/g, '');
  if (
    slug.length < VALIDATION_LENGTHS.VANITY_URL_MIN ||
    !VALIDATION_REGEX.VANITY_URL_FORMAT.test(slug)
  ) {
    return null;
  }
  return slug;
}

/** Pure: the first source (in priority order) that yields a usable slug. */
export function pickVanityBase(
  sources: readonly (string | null | undefined)[]
): string | null {
  for (const source of sources) {
    const base = slugifyVanityBase(source ?? null);
    if (base) {
      return base;
    }
  }
  return null;
}

/** Pure: `[base, base-2..base-9]` — the only addresses a slug may take first. */
export function vanityCandidates(base: string): string[] {
  return [base, ...NUMBERED_SUFFIXES.map(n => `${base}-${n}`)];
}

/** Pure: first candidate from `[base, base-2..base-9]` not in `taken`/reserved. */
export function pickFreeVanity(
  base: string,
  taken: ReadonlySet<string>,
  randomTail: () => string
): string {
  const free = vanityCandidates(base).find(
    c => !taken.has(c) && !RESERVED_VANITY_URLS.includes(c)
  );
  return free ?? `${base}-${randomTail()}`;
}

const randomTail = (): string =>
  Math.floor(1000 + Math.random() * 9000).toString();

/**
 * Best-effort: give the stylist account an address if it has none. Never
 * throws and never fails the caller (onboarding already succeeded).
 */
export const assignAutoVanityUrl_IO = async (
  accountId: string,
  sources: readonly (string | null | undefined)[]
): Promise<void> => {
  const base = pickVanityBase(sources);
  if (!base) {
    return;
  }
  try {
    // Exact candidate set, not a prefix scan: `anna%` also matches
    // `anna-kowalska`/`annabelle`, and a capped page of those could hide a
    // taken candidate, turning the write into a guaranteed P2002.
    const candidates = vanityCandidates(base);
    const rows = await DB_CLIENT.use.stylistAccount.findMany({
      where: { vanity_url: { in: candidates } },
      select: { vanity_url: true },
      take: candidates.length,
    });
    const taken = new Set(
      rows
        .map(r => r.vanity_url)
        .filter((v): v is string => typeof v === 'string')
    );
    const vanity = pickFreeVanity(base, taken, randomTail);
    // `vanity_url: null` in the filter: never overwrite an address the stylist
    // set herself in the meantime.
    await DB_CLIENT.use.stylistAccount.updateMany({
      where: { account_id: accountId, vanity_url: null },
      data: { vanity_url: vanity },
    });
  } catch (error: unknown) {
    // P2002 = someone claimed the same address between read and write. The
    // stylist keeps "Ustaw własny link" in /app/profile; nothing else breaks.
    reportIssueBackend({
      namespace: 'AUTO_VANITY_URL',
      message:
        hasCode(error) && error.code === 'P2002'
          ? 'Auto vanity collided with a concurrent claim (skipped)'
          : `Auto vanity assignment failed: ${error instanceof Error ? error.message : String(error)}`,
      payload: { account_id: accountId },
      mode: 'warn',
    });
  }
};
