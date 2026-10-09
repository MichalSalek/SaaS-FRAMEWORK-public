// UI/features/stylist/StylistProfilePage.query.ts
// Query options publicznego profilu — wydzielone z composition (max-lines 300,
// S76). Kanon: silentBusinessError + SSR initialData (DECISION niżej).

import { queryOptions } from '@tanstack/react-query';
import { getPublicProfile_IO } from '../../../domain/account/accountIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import type { StylistProfileData } from './_jsonld.helpers';

export const profileQueryOptions = (
  identifier: string,
  initialProfile?: StylistProfileData | null
) =>
  queryOptions({
    queryKey: queryKeys.account.profile(identifier),
    // DECISION (nie usuwaj tego komentarza):
    // silentBusinessError: publiczny profil to SEO/share entry-point, w który
    // trafia się z linku/QR — link bywa martwy (profil usunięty/dezaktywowany,
    // literówka, wygasła wizytówka). Wtedy backend zwraca 404, a interceptor
    // (warstwa 1) domyślnie toastuje snackbar „Nie znaleziono konta" — NA GÓRZE
    // strony, która JUŻ renderuje dedykowany EmptyState „Nie znaleziono profilu
    // stylistki" (podwójny, sprzeczny słownie komunikat tego samego stanu, klasa
    // S74). Flaga wycisza WYŁĄCZNIE snackbar biznesowego 4xx: passCallback nadal
    // osadza query jako handled-error (isError → EmptyState), a 401/5xx NADAL
    // toastują (kontrakt http.interceptor). SSR (getServerSideProps, raw fetch)
    // jest poza tym query — dotyczy tylko client-side re-fetcha na not-found.
    queryFn: ({ signal }) =>
      getPublicProfile_IO(
        { identifier },
        { signal, silentBusinessError: true }
      ),
    enabled: identifier.length > 0,
    staleTime: 60_000,
    // DECISION (nie usuwaj): initialData z SSR (B20). Gdy getServerSideProps dostarczy
    // profil, klient nie re-fetchuje na cold loadzie (fresh przez staleTime). Typ
    // StylistProfileData ≡ GET_PUBLIC_PROFILE RESPONSE → brak hydration mismatch.
    ...(initialProfile ? { initialData: initialProfile } : {}),
  });
