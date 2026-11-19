export const CONTACT_ACCESS_TYPE = {
  VIEW_CONTACT: 'VIEW_CONTACT',
  EXPORT_CONTACT: 'EXPORT_CONTACT',
} as const;

export type ContactAccessType =
  (typeof CONTACT_ACCESS_TYPE)[keyof typeof CONTACT_ACCESS_TYPE];
