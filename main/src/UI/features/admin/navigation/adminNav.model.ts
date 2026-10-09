// UI/features/admin/navigation/adminNav.model.ts
// What a menu entry (sidebar row, phone tab) shows for its counters: the
// number, where a tap leads right now, and the sentence that says what the
// number counts (the badge's accessible name). Pure, so the sidebar and the
// phone tabs cannot disagree.

import {
  ADMIN_ATTENTION_COPY_VALUES,
  formatAttentionBadge,
  resolveAttentionTarget,
  type AdminAttentionCounts,
  type AdminAttentionKey,
} from '../admin-attention.config';

/** `useTranslations('admin.attention')`. */
export type AttentionTranslator = (
  key: string,
  values?: Record<string, string | number>
) => string;

export interface NavAttention {
  count: number;
  /** Badge text (the number, capped). */
  badge: string;
  /** Destination of the entry right now. */
  href: string;
  /** What the number counts, in words; null when nothing waits. */
  description: string | null;
}

export interface NavAttentionSource {
  path: string;
  attentionKeys?: readonly AdminAttentionKey[];
  /**
   * The entry's own page lists all of its queues (the dashboard panel), so
   * the destination never changes and the number is described as a total.
   */
  attentionOwnPage?: boolean;
}

export function resolveNavAttention(
  source: NavAttentionSource,
  counts: AdminAttentionCounts | null,
  t: AttentionTranslator
): NavAttention {
  const ownPage = source.attentionOwnPage === true;
  const target = resolveAttentionTarget(
    source.path,
    source.attentionKeys ?? [],
    counts,
    ownPage
  );
  const description =
    target.count === 0
      ? null
      : ownPage
        ? t('totalBadge', { count: target.count })
        : target.active
            .map(signal =>
              t(signal.countLabelKey, {
                ...ADMIN_ATTENTION_COPY_VALUES,
                count: counts?.[signal.key] ?? 0,
              })
            )
            .join(', ');
  return {
    count: target.count,
    badge: formatAttentionBadge(target.count),
    href: target.href,
    description,
  };
}

/**
 * Path-boundary-safe „is this admin page (or a page under it) open”: exact
 * match, or a prefix that ends at a `/`. A bare startsWith also matched
 * siblings with a shared prefix (/app/admin/users vs /app/admin/users-export).
 * The admin root matches only itself, or every page would light it.
 */
export function isAdminPathActive(
  pathname: string,
  path: string,
  rootPath: string
): boolean {
  if (path === rootPath) {
    return pathname === path;
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}
