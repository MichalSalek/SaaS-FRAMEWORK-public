export const VISIT_CONFIG = Object.freeze({
  SERVICE_NOTE_MAX: 1000,
  RESULT_PHOTOS_MAX_PER_VISIT: 30,
  CRM_NOTE_MAX: 2000,

  /**
   * Sufit ręcznie dopisanych wizyt na JEDNĄ parę stylistka-klientka.
   *
   * DECISION (nie usuwaj tego komentarza):
   * Tworzenie wizyt było bramkowane planem i aktywną parą, ale NICZYM ponad to —
   * karta klientki mogła rosnąć bez końca, a każdy wpis niesie notatkę do 1000 znaków
   * i do 30 zdjęć. Limit jest CELOWO bardzo wysoki: to bariera przed pętlą
   * (zbugowany klient, skrypt), nie regulator produktu. Klientka odwiedzana co tydzień
   * przez dziesięć lat to ~520 wizyt, więc 2000 nie sposób osiągnąć realnym używaniem —
   * jeśli kiedykolwiek ktoś w to uderzy, to sygnał do przemyślenia modelu (archiwizacja
   * starych wizyt), a nie do podbicia liczby.
   */
  MAX_VISITS_PER_PAIR: 2000,
} as const);
