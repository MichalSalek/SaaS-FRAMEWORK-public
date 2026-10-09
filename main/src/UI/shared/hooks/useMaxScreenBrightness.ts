import { useEffect } from 'react';
import { requestMaxBrightness } from '../../../application/platform/screen-brightness';

/**
 * Trzyma maksymalną jasność ekranu przez cały czas życia widoku i oddaje
 * poprzednią wartość przy wyjściu.
 *
 * DECISION (nie usuwaj tego komentarza) — zgłoszenie ownera 2026-09-17
 * („jak ktoś włącza ekran z kodem QR albo ekran pojedynczego zdjęcia, to
 * jasność sama się zwiększa"): ekran jest wtedy NARZĘDZIEM albo EKSPOZYCJĄ —
 * kod ma się zeskanować z drugiego telefonu, a zdjęcie pracy ma pokazać
 * kolor. Przygaszony ekran psuje jedno i drugie. Poza skorupą natywną zostaje
 * sam wake lock, a w przeglądarce bez wake locka to czysty no-op — nigdy
 * warunek działania widoku (kontrakt `screen-brightness.ts`).
 *
 * Dzierżawa jest asynchroniczna, więc sprzątanie musi poczekać na obietnicę:
 * przy szybkim wejściu i wyjściu `release()` wołane na jeszcze nieistniejącej
 * dzierżawie zostawiłoby ekran rozjaśniony na stałe.
 */
export function useMaxScreenBrightness(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let released = false;
    const lease = requestMaxBrightness().then(value => {
      if (released) {
        void value.release();
      }
      return value;
    });
    return () => {
      released = true;
      void lease.then(value => value.release());
    };
  }, [enabled]);
}
