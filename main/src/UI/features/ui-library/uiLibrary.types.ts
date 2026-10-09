/**
 * Typy rejestru biblioteki komponentów (/ui, dev-only). Wydzielone z
 * uiLibrary.registry.ts (W1.6), gdy plik danych przekroczył limit max-lines —
 * dane wpisów zostają w rejestrze, kontrakt typów żyje tutaj.
 *
 * FROZEN = komponent klepnięty (głos ownera w sesji /ui lub zapisana
 *          DECISION w kodzie) — zmiany wizualne TYLKO przez sesję /ui
 *          z głosem ownera; strony używają komponentu, nie kopiują CSS.
 * DRAFT  = stabilne API i realne użycia, ale wizual może się jeszcze
 *          zmienić bez głosowania.
 */

type UiLibraryStatus = 'FROZEN' | 'DRAFT';

export interface UiLibraryEntryMeta {
  /** Anchor wpisu (TOC linkuje #id). */
  id: string;
  name: string;
  /** Ścieżka importu względem main/ (bez rozszerzenia). */
  importPath: string;
  status: UiLibraryStatus;
  /** Jedno zdanie: kiedy używać. */
  whenToUse: string;
  /** Wpis opisowy: powód braku żywego renderu. */
  noRenderReason?: string;
}

export interface UiLibraryGroup {
  id: string;
  title: string;
  entries: ReadonlyArray<UiLibraryEntryMeta>;
}
