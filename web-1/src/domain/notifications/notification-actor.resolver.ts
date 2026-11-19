/**
 * Display-name snapshots for the `actor_name` column. Pure: the listeners
 * read the rows, these pick the words. An empty name becomes null, so the
 * copy table falls back to the role name; an e-mail is NEVER a name here
 * (the messaging mail may show a client's e-mail to the stylist on an ACTIVE
 * pair; a notification row must not carry it).
 */
const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export const resolveStylistActorName = (stylist: {
  display_name?: string | null;
  business_name?: string | null;
  created_by_user?: { name?: string | null } | null;
}): string | null =>
  nonEmpty(stylist.display_name) ??
  nonEmpty(stylist.business_name) ??
  nonEmpty(stylist.created_by_user?.name);

export const resolveClientActorName = (
  name: string | null | undefined
): string | null => nonEmpty(name);
