export const DEV_FILM_ASSETS = [
  'manifest.json',
  'film-current.mp4',
  'film-current.vtt',
  'film-current.jpg',
  'film-instruction.mp4',
  'film-instruction.vtt',
  'film-instruction.jpg',
  'film-instruction-original.mp4',
  'voiceover-pl.txt',
  'voiceover-en.txt',
  'captions-de.srt',
] as const;

export type DevFilmAsset = (typeof DEV_FILM_ASSETS)[number];

export type DevFilm = {
  id: 'current' | 'instruction';
  title: string;
  description: string;
  revision: string;
  seconds: number;
  video: DevFilmAsset;
  poster: DevFilmAsset;
  captions: DevFilmAsset;
  captionsDefault: boolean;
  note: string;
  downloads: Array<{ label: string; asset: DevFilmAsset }>;
  music: {
    label: string;
    title: string;
    author: string;
    source: string;
    licenseUrl: string;
    edits: string;
  } | null;
};

export type DevVoiceover = {
  id: 'pl' | 'en' | 'de';
  label: string;
  title: string;
  kind: 'voice' | 'captions';
  script: string;
  download: DevFilmAsset;
  cues: Array<{ start: number; end: number; text: string }>;
};

export type DevFilmsManifest = {
  version: 1;
  films: DevFilm[];
  voiceovers: DevVoiceover[];
  recordingNote: string;
  timingNote: string;
};

export const devFilmUrl = (asset: DevFilmAsset) => `/api/dev/films/${asset}`;
