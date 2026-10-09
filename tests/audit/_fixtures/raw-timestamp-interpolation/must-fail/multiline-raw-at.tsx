// THE shape the old single-line regex could never see, and the shape this repo
// actually formats to (prettier breaks the argument object onto its own lines).
// All three sites this guard was written for look exactly like this.
declare function t(key: string, values?: Record<string, unknown>): string;
declare const stylist: { paired_at: string };

export function pairedLabel(): string {
  return t('pairedAt', {
    date: stylist.paired_at,
  });
}
