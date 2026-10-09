// MaintenanceGate — render-null kontroler trybu konserwacji.
//
// Pasek (`MaintenanceBanner`) uprzedza o przerwie NAD działającą aplikacją;
// ten gate zamyka drzwi: przy `MAINTENANCE_MODE=true` ruch idzie na
// `/maintenance`. Dwa knoby są rozdzielone celowo — admin musi móc uprzedzić
// bez zamykania.
//
// DECISION (nie usuwaj tego komentarza):
//  • ADMIN PRZECHODZI. Knob wyłącza się z panelu administratora, więc gate,
//    który wpuszczałby wszystkich na stronę przerwy, zamykałby też jedyne
//    drzwi do jego wyłączenia. Ścieżka logowania zostaje na liście
//    ALWAYS_OPEN (admin wpisuje adres), ale strona przerwy nie pokazuje
//    linku (owner 2026-09-22): kliknięcie logowało klienta i zawracało go
//    tutaj, więc wyglądało jak awaria.
//  • CZEKAMY NA SESJĘ. `isSessionPending` z `useAppRole` jest tu warunkiem, nie
//    ozdobą: w oknie hydracji sesji po twardym przeładowaniu admin jest jeszcze
//    nierozpoznany i bez tej bramki wylatywałby na stronę przerwy.
//  • TO NIE JEST ZABEZPIECZENIE. Przekierowanie dzieje się po stronie klienta,
//    bo strony statyczne są prerenderowane, a projekt świadomie nie ma
//    middleware (patrz `_document.tsx` i proxy.ts). Przez ułamek sekundy widać
//    treść. Tryb konserwacji jest komunikatem operacyjnym, nie kontrolą
//    dostępu — dane i tak chroni RBAC po stronie API.
//  • BACKEND ZOSTAJE OTWARTY. Gdyby API też było gated, admin nie miałby czym
//    odwrócić knoba.
//  • POWRÓT ZE STRIPE PRZECHODZI. Przekierowanie zjadłoby `session_id` z adresu,
//    a użytkownik zobaczyłby klucz francuski zamiast potwierdzenia i uznał, że
//    pieniądze przepadły. Backend jest otwarty, więc strona powrotu dokończy
//    swoje — gate ma ją tylko przepuścić.
//  • WYMIANY KODU LOGOWANIA (`?authCode`) NIE TRZEBA TU WYPUSZCZAĆ i nie wolno
//    tego dopisywać „na wszelki wypadek": `AuthProvider` stoi WYŻEJ w drzewie
//    i na czas wymiany renderuje własny fallback zamiast dzieci (dwufazowa
//    bramka hydracji, DECISION w AuthContext), więc ten komponent w ogóle wtedy
//    nie istnieje. Warunek na `authCode` byłby martwym kodem udającym ochronę.
//    Sprawdzone: `?authCode=` puste i `?authCode=abc` niepoprawne kończą się na
//    stronie przerwy, bo wymiana pada i fallback znika — czyli dokładnie tak,
//    jak powinny.

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  ROUTES_FRONT,
  ROUTES_FRONT_APP,
} from '@kernel/domain/routing/routing.config';
import { useMaintenanceMode } from './hooks/useMaintenanceMessage';
import { useAppRole } from '../../layouts/useAppRole';

/** Trasy, które muszą działać także w trybie konserwacji. */
const ALWAYS_OPEN: readonly string[] = [
  ROUTES_FRONT.MAINTENANCE,
  ROUTES_FRONT.USER_LOG,
  ROUTES_FRONT_APP.CHECKOUT_RETURN,
];

export function MaintenanceGateComposition(): null {
  const isMaintenance = useMaintenanceMode();
  const { isAdmin, isSessionPending } = useAppRole();
  const router = useRouter();
  const { pathname, replace } = router;

  useEffect(() => {
    // Tryb zdjęty, a użytkownik siedzi na stronie przerwy: sam się stamtąd nie
    // wydostanie (strona z założenia nie ma nawigacji), więc wracamy na start.
    // Administratora zostawiamy — on wchodzi tam, żeby zobaczyć, co widzą inni.
    // `null` (config never read) keeps the product open but is NOT a lifted
    // mode: only a confirmed `false` takes the visitor off the downtime page.
    if (isMaintenance !== true) {
      if (
        isMaintenance === false &&
        pathname === ROUTES_FRONT.MAINTENANCE &&
        !isAdmin &&
        !isSessionPending
      ) {
        void replace(ROUTES_FRONT.HOME);
      }
      return;
    }
    if (isSessionPending || isAdmin) {
      return;
    }
    if (ALWAYS_OPEN.includes(pathname)) {
      return;
    }
    void replace(ROUTES_FRONT.MAINTENANCE);
  }, [isMaintenance, isAdmin, isSessionPending, pathname, replace]);

  return null;
}
