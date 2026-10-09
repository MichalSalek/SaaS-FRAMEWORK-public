import { useEffect } from 'react';

// DECISION (nie usuwaj tego komentarza):
// Lock obejmuje `document.body` ORAZ `#main-content` — w app shellu realnym
// scrollerem NIE jest body (AppLayout `.shell` ma overflow:hidden, scrolluje
// wewnętrzny `main#main-content` z overflow-y:auto), więc lock samego body był
// no-opem dla modali/drawera wewnątrz /app. Na stronach statycznych (brak
// #main-content) lockuje się samo body. Współdzielony licznik zostaje: wiele
// równoczesnych locków (modal nad drawerem) zwalnia scroll dopiero, gdy
// ostatni konsument się odblokuje. Inline `overflow` czyszczony do '' —
// overflow-y:auto scrollera wraca z jego klasy CSS.

let lockCount = 0;

const MAIN_CONTENT_ID = 'main-content';

function setScrollersOverflow(value: string): void {
  document.body.style.overflow = value;
  const mainScroller = document.getElementById(MAIN_CONTENT_ID);
  if (mainScroller instanceof HTMLElement) {
    mainScroller.style.overflow = value;
  }
}

export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }

    lockCount++;
    setScrollersOverflow('hidden');

    return () => {
      lockCount--;
      if (lockCount === 0) {
        setScrollersOverflow('');
      }
    };
  }, [active]);
}
