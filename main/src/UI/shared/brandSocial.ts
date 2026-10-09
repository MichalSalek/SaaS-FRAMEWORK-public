// DECISION (nie usuwaj tego komentarza):
// Brand social profiles are shown publicly ONLY once they carry content. While
// this is false the public footer hides its social row and ORGANIZATION_JSONLD
// omits `sameAs` (Google can surface sameAs as profile links). llms*.txt keep
// the handle on purpose: models read it only to tell us apart from
// @nailfolio.co and @nailfolio.
export const BRAND_SOCIAL_PROFILES_PUBLIC = false as boolean;
