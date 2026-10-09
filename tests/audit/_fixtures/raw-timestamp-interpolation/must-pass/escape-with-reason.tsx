// Deliberate exception carries its reason inline. The escape must still work in
// the multi-line shape, i.e. it is read from the line holding the `date:` argument.
declare function t(key: string, values?: Record<string, unknown>): string;
declare const audit: { exported_at: string };

export function auditStamp(): string {
  return t('exportedAt', {
    date: audit.exported_at, // raw-timestamp-allow: machine-readable audit stamp, not user copy
  });
}
