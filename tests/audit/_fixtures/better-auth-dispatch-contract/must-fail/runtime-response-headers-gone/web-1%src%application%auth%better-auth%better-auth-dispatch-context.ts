// Fixture-stub akcesora. SAMODZIELNY i otypowany: tests/tsconfig kompiluje
// _fixtures/ jak każde inne źródło, więc import albo `any` wywraca `npm run typecheck`.
type FixtureCtx = { readonly context?: { readonly [k: string]: unknown } };
type DispatchRuntimeFields = {
  readonly returned?: unknown;
  readonly responseHeaders?: Headers | undefined;
};
const readDispatchFields = (ctx: FixtureCtx): DispatchRuntimeFields =>
  (ctx.context ?? {}) as DispatchRuntimeFields;
export const getDispatchReturned = (ctx: FixtureCtx): unknown =>
  readDispatchFields(ctx).returned;
export const getDispatchResponseHeaders = (
  ctx: FixtureCtx
): Headers | undefined => readDispatchFields(ctx).responseHeaders;
