// Fixture-konsument. Zero importów (patrz stub akcesora) — wywołania akcesora są
// tu LOKALNE, bo strażnik liczy MIEJSCA UŻYCIA nazwy, nie rozwiązuje modułów.
type FixtureCtx = { readonly context?: { readonly [k: string]: unknown } };
declare const getDispatchReturned: (ctx: FixtureCtx) => unknown;
declare const getDispatchResponseHeaders: (
  ctx: FixtureCtx
) => Headers | undefined;

export const trackFailure = (ctx: FixtureCtx): unknown =>
  getDispatchReturned(ctx);
export const bridge = (ctx: FixtureCtx): string | null =>
  getDispatchResponseHeaders(ctx)?.get('location') ?? null;
