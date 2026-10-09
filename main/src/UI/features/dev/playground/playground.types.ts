/** One candidate of an owner vote. DZIŚ is implicit and always first. */
export interface PlaygroundCandidate {
  /** Stable id used in `?pg=<voteId>:<id>` and in stored votes. */
  id: string;
  /** Short label on the switch, e.g. „B: Podgląd pięciu”. */
  label: string;
  /** One or two sentences: what changes against DZIŚ and what it costs. */
  rationale: string;
}

interface PlaygroundVoteBase {
  /** Stable id: session number plus topic, e.g. `s124-dashboard-clients`. */
  id: string;
  title: string;
  /** The decision the owner makes, phrased as a question. */
  question: string;
  /** Measured problem that opened the vote (numbers, not taste). */
  finding: string;
  candidates: readonly PlaygroundCandidate[];
  /** What must be true to see real data, e.g. the demo account to log in as. */
  prerequisite?: string;
  /** Account the frames must be logged in as (DEVELOPMENT: one-click dev-login). */
  loginAs?: { email: string; label: string };
}

/** A vote over ONE route: candidates branch inside the product component (`?pg=`). */
export interface PlaygroundRouteVote extends PlaygroundVoteBase {
  kind?: 'route';
  /** Live route, locale-free, e.g. `/app/`. Candidates add `?pg=`. */
  route: string;
  /** Viewport widths in CSS px; the first is the default. */
  widths: readonly number[];
}

/** One surface of a palette vote: a live route at a fixed width and mode. */
export interface PlaygroundPaletteSurface {
  id: string;
  label: string;
  route: string;
  width: number;
  mode: 'light' | 'dark';
}

/**
 * A vote over PALETTES: every candidate id is a `[data-theme]` slug with a
 * block in the global sheet, applied to the framed page through the dev-only
 * `?t=<slug>` override; the same surfaces render under every candidate.
 */
export interface PlaygroundPaletteVote extends PlaygroundVoteBase {
  kind: 'palette';
  surfaces: readonly PlaygroundPaletteSurface[];
}

export type PlaygroundVote = PlaygroundRouteVote | PlaygroundPaletteVote;

export const TODAY_CANDIDATE: PlaygroundCandidate = {
  id: 'today',
  label: 'DZIŚ',
  rationale: 'Produkcja bez zmian, na tych samych danych i szerokości.',
};
