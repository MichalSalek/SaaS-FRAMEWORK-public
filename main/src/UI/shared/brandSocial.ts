// DECISION: brand social profiles are public ONLY once they carry content (an
// empty Instagram lost a visitor). While false, the footer, the contact page
// and the Organization JSON-LD `sameAs` hide them. Flip once Instagram has ~9
// posts. llms*.txt keep the handle on purpose, to tell us apart from
// @nailfolio.co and @nailfolio. (owner)
export const BRAND_SOCIAL_PROFILES_PUBLIC = false as boolean;
