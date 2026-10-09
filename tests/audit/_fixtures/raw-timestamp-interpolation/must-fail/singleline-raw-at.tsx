// The single-line shape. The old regex caught this one — and it occurs ZERO times
// in the real tree, which is why the guard was effectively blind. Kept so the
// rewrite cannot regress the case that used to work.
declare function t(key: string, values?: Record<string, unknown>): string;
declare const record: { created_at: string };

export const label = (): string => t('createdAt', { date: record.created_at });
