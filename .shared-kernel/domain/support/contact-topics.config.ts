// SSOT: Valid contact form topics

export const VALID_CONTACT_TOPICS = [
  'stylistka',
  'klientka',
  'cennik',
  'bug',
  'wspolpraca',
  'inne',
] as const;
export type ContactTopic = (typeof VALID_CONTACT_TOPICS)[number];
