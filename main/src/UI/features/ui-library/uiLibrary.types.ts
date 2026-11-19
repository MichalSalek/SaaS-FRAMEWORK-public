/**
 * Types for the component-library registry (/ui, dev-only). Split out of
 * uiLibrary.registry.ts when that data file passed the max-lines cap.
 * Entry data stays in the registry. The type contract lives here.
 *
 * FROZEN = an approved component (owner vote in a /ui session or a recorded
 *          DECISION in the code). Visual changes only through a /ui session
 *          with an owner vote. Pages use the component and never copy its CSS.
 * DRAFT  = stable API and real usages, but the visual may still change
 *          without a vote.
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
