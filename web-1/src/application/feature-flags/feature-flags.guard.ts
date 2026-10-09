import type { NextApiResponse } from 'next';
import { getFeatureFlags } from './feature-flags.cache';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { respondNotFound } from '@app/http/http.responses.utils';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

// DECISION (nie usuwaj tego komentarza):
// Back-guard dla SALON_STAFF_ENABLED kill-switch. Czyta LIVE wartosc flagi z
// getFeatureFlags() (DB+cache, runtime-reactive na admin toggle) — NIE z
// FEATURE_FLAG_DEFAULTS i NIE z public endpointu (flaga nie jest w
// PUBLIC_FEATURE_FLAG_KEYS, wiec front getFeatureFlagServerSide jej nie widzi).
// KRYTYCZNE security: front route gate to wylacznie UI-hide; bez tego back-guardu
// flaga=false zostawia api/v1/salon/staff/** otwarte (IDOR bypass). Guard zywie w
// 4 handlerach (index GET+POST, [staffId] GET, update PATCH, delete DELETE) PO RBAC
// (requireStylistAccount), PRZED wywolaniem operacji — operacje przyjmuja tylko
// {accountId, pricingPlan} bez currentUser, wiec guard MUSI byc w warstwie handlera.
//
// Disabled -> 404 NOT_FOUND (nie 403): maskuje istnienie feature'a, spojnie z
// front-gate ktory zwraca notFound, i z IDOR-masking stosowanym w error-mapper
// (SUPPORT_THREAD_NOT_AUTHORIZED -> 404). Fail-closed: jesli getFeatureFlags rzuci,
// blad propaguje do timing.middleware (-> 500), endpoint NIE wykonuje operacji.
//
// Zwraca true = enabled (handler kontynuuje), false = disabled (odpowiedz juz wyslana,
// handler MUSI zrobic `return`).
export const requireSalonStaffEnabled = async (
  res: NextApiResponse
): Promise<boolean> => {
  const flags = await getFeatureFlags();
  const enabled = flags.get(FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED) ?? false;
  if (!enabled) {
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, undefined);
    return false;
  }
  return true;
};

// DECISION (nie usuwaj tego komentarza):
// Back-guard dla EXPLORE_ENABLED (kernel default OFF). Mirror requireSalonStaffEnabled:
// czyta LIVE flage z getFeatureFlags() (runtime-reactive na admin toggle), disabled ->
// 404 NOT_FOUND (maskuje feature, spojnie z front-gate getFeatureFlagServerSide w
// app/explore/index.tsx). Bez tego back-guardu flaga=false zostawia
// api/v1/gallery/explore otwarte (discovery feed serwowany mimo wylaczonego explore =
// ten sam IDOR-class gap co salon mial przed r31). Fail-closed (?? false = kernel
// default OFF). Zwraca true=enabled (handler kontynuuje), false=disabled (odpowiedz
// wyslana, handler MUSI `return`).
export const requireExploreEnabled = async (
  res: NextApiResponse
): Promise<boolean> => {
  const flags = await getFeatureFlags();
  const enabled = flags.get(FEATURE_FLAG_KEYS.EXPLORE_ENABLED) ?? false;
  if (!enabled) {
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, undefined);
    return false;
  }
  return true;
};
