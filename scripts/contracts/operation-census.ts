/**
 * Eligible JSON operations are every method-registry key that is not a raw protocol.
 * The census reads the whole registries the caller passes; it does not keep its own list.
 */

export type OperationCensusInput = {
  methodKeys: readonly string[];
  routeKeys: readonly string[];
  contractKeys: readonly string[];
  rawProtocolIds: readonly string[];
  /** Route keys that name a shared parent path, not an operation and not a raw protocol. */
  parentRouteKeys: readonly string[];
};

export type OperationCensus = {
  rawMethodKeys: string[];
  eligibleMethodKeys: string[];
  missingContracts: string[];
  contractsMissingMethod: string[];
  contractsMissingRoute: string[];
  unexpectedRouteKeys: string[];
  parentRouteProblems: string[];
};

const sorted = (keys: readonly string[]): string[] => [...keys].sort();

export const censusOperations = (
  input: OperationCensusInput
): OperationCensus => {
  const rawIds = new Set(input.rawProtocolIds);
  const methods = new Set(input.methodKeys);
  const routes = new Set(input.routeKeys);
  const contracts = new Set(input.contractKeys);
  const parents = new Set(input.parentRouteKeys);
  const rawMethodKeys = sorted(input.methodKeys.filter(key => rawIds.has(key)));
  const eligibleMethodKeys = sorted(
    input.methodKeys.filter(key => !rawIds.has(key))
  );
  const allowedRouteExtras = new Set([
    ...input.rawProtocolIds.filter(id => routes.has(id)),
    ...input.parentRouteKeys,
  ]);
  return {
    rawMethodKeys,
    eligibleMethodKeys,
    missingContracts: eligibleMethodKeys.filter(key => !contracts.has(key)),
    contractsMissingMethod: sorted(
      input.contractKeys.filter(key => !methods.has(key))
    ),
    contractsMissingRoute: sorted(
      input.contractKeys.filter(key => !routes.has(key))
    ),
    unexpectedRouteKeys: sorted(
      input.routeKeys.filter(
        key => !contracts.has(key) && !allowedRouteExtras.has(key)
      )
    ),
    parentRouteProblems: sorted([
      ...input.parentRouteKeys.filter(
        key => !routes.has(key) || contracts.has(key) || rawIds.has(key)
      ),
      ...(parents.size === input.parentRouteKeys.length
        ? []
        : ['duplicate parent route key']),
    ]),
  };
};
