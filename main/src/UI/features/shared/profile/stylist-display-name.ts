/** The public profile, its request confirmation and the outcome use the same identity. */
export const stylistDisplayName = (
  account: { display_name: string | null; business_name: string | null },
  fallback: string
): string => account.display_name || account.business_name || fallback;
