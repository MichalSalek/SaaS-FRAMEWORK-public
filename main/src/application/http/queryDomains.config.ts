// SSOT for TanStack Query domain prefixes.
// All query keys MUST use these constants as their first tuple element.
// Adding a new domain? Add it here, then define keys in queryKeys.factory.ts.

export const QD = {
  ACCOUNT: 'account',
  GALLERY: 'gallery',
  PAIRING: 'pairing',
  BOOKMARK: 'bookmark',
  FAVORITE: 'favorite',
  STAFF: 'staff',
  BLOG: 'blog',
  ADMIN: 'admin',
  PRICING: 'pricing',
  CLIENT: 'client',
  SESSION_CONTAINER: 'sessionContainer',
  PUBLIC: 'public',
  SESSION: 'session',
  EVENT_LOG: 'eventLog',
  SUPPORT: 'support',
  MESSAGING: 'messaging',
} as const;
