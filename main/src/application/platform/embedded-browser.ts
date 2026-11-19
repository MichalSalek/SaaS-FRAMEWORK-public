/**
 * Instagram and Facebook in-app browsers. Google refuses OAuth there
 * (`403 disallowed_useragent`). Magic-link login still works.
 */
const EMBEDDED_SOCIAL_UA = /Instagram|FBAN|FBAV/i;

export const isEmbeddedSocialBrowser = (userAgent: string): boolean =>
  EMBEDDED_SOCIAL_UA.test(userAgent);
