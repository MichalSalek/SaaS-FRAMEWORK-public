/** Client attribution is descriptive, not an authorization claim. Older clients remain identifiable. */
export const EMAIL_PREFERENCE_CLIENT_SOURCES = [
  'account_settings',
  'first_photo',
  'gallery_prompt',
] as const;

export type EmailPreferenceSource =
  | (typeof EMAIL_PREFERENCE_CLIENT_SOURCES)[number]
  | 'registration'
  | 'unsubscribe_link'
  | 'unspecified';
