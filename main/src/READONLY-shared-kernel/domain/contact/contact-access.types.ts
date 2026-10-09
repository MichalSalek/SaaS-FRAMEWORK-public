/**
 * Contact access type — GDPR Art. 32 access audit trail.
 *
 * Used in the append-only ContactAccessLog table (who accessed a client's
 * contact data, and when).
 * VIEW_CONTACT = a paired stylist viewed the client's contact details.
 * EXPORT_CONTACT = the client's contact data was exported / downloaded.
 */
export const CONTACT_ACCESS_TYPE = {
  VIEW_CONTACT: 'VIEW_CONTACT',
  EXPORT_CONTACT: 'EXPORT_CONTACT',
} as const;

export type ContactAccessType =
  (typeof CONTACT_ACCESS_TYPE)[keyof typeof CONTACT_ACCESS_TYPE];
