// DECISION: Stripe login sync cannot import the general interceptors barrel: that barrel loads
// authentication and would close a runtime auth cycle. This narrow gateway crosses the
// application/domain boundary without auth imports.
export { reconcileSalonDerivedPairings_IO } from '@domain/pairing/salon-derived-cleanup.operations';
