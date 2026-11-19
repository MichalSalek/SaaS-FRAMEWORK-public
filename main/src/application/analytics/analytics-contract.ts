export const DATA_LAYER_PROPERTY_KEYS = [
  'location',
  'plan',
  'role',
  'target',
  'depth',
  'billing_period',
  'billing_country',
  'currency',
  'confirmation_kind',
  'measurement_version',
  'measurement_changed_at',
  'demo',
  'demo_action',
  'demo_value',
  'method',
  'intent',
  'first_source',
  'first_landing',
  'first_cta',
] as const;

export function createOncePerPageViewGuard() {
  const seen = new Set<string>();

  return {
    mark(key: string): boolean {
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    },
    reset(): void {
      seen.clear();
    },
  };
}
