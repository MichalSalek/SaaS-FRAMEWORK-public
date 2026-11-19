import { useEffect, useRef, useState } from 'react';
import { AppLinkAtom } from '../../../components/AppLink/AppLink.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import {
  devFilmUrl,
  type DevFilm,
  type DevFilmsManifest,
} from '../../../../application/dev-films/dev-films.contract';
import styles from './DevFilmsPage.module.css';

function Film({ film }: { film: DevFilm }) {
  const [failed, setFailed] = useState(false);
  return (
    <article className={styles.card} aria-labelledby={`film-${film.id}`}>
      <header className={styles.filmHeader}>
        <div className={styles.meta}>
          <span>{film.revision}</span>
          <span>{film.seconds} sekund</span>
          <span>{film.id === 'current' ? 'Aktualny' : 'Archiwalny'}</span>
        </div>
        <h2 id={`film-${film.id}`}>{film.title}</h2>
        <p>{film.description}</p>
      </header>
      <video
        className={styles.video}
        controls
        playsInline
        preload='metadata'
        poster={devFilmUrl(film.poster)}
        src={devFilmUrl(film.video)}
        aria-label={`${film.title}, ${film.seconds} sekund`}
        onPlay={event => {
          // A second preview must not speak or play music over the first one.
          const active = event.currentTarget;
          active
            .closest('main')
            ?.querySelectorAll('video')
            .forEach(video => {
              if (video !== active) {
                video.pause();
              }
            });
        }}
        onError={() => setFailed(true)}>
        <track
          kind='captions'
          srcLang='pl'
          label='Polski'
          src={devFilmUrl(film.captions)}
          default={film.captionsDefault}
        />
      </video>
      {failed && (
        <p role='alert'>
          Nie udało się odtworzyć filmu. Spróbuj pobrać plik poniżej.
        </p>
      )}
      <p>{film.note}</p>
      <div className={styles.actions}>
        {film.downloads.map(download => (
          <a
            key={download.asset}
            href={devFilmUrl(download.asset)}
            download
            className={styles.link}>
            {download.label}
          </a>
        ))}
      </div>
      {film.music && (
        <p className={styles.credit}>
          {film.music.label}: „{film.music.title}”, {film.music.author}.{' '}
          <a href={film.music.source} className={styles.link}>
            Źródło
          </a>
          ,{' '}
          <a href={film.music.licenseUrl} className={styles.link}>
            CC BY 4.0
          </a>
          . {film.music.edits}.
        </p>
      )}
    </article>
  );
}

function Voiceover({ data }: { data: DevFilmsManifest }) {
  const [language, setLanguage] = useState('pl');
  const [copied, setCopied] = useState('');
  const script = useRef<HTMLParagraphElement>(null);
  const selected = data.voiceovers.find(version => version.id === language);
  if (!selected) {
    return null;
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(selected.script);
      setCopied(
        selected.kind === 'voice' ? 'Tekst skopiowany.' : 'Napisy skopiowane.'
      );
    } catch {
      if (script.current) {
        window.getSelection()?.selectAllChildren(script.current);
      }
      setCopied('Tekst jest zaznaczony. Skopiuj go ręcznie.');
    }
  };
  return (
    <section className={styles.card} aria-labelledby='voiceovers-heading'>
      <h2 id='voiceovers-heading'>Teksty do lektora</h2>
      <p>
        PL: polski lektor. EN: angielski lektor. DE: angielski lektor i
        niemieckie napisy.
      </p>
      <p>{data.recordingNote}</p>
      <div
        className={styles.actions}
        role='group'
        aria-label='Język nagrania lub napisów'>
        {data.voiceovers.map(version => (
          <ButtonAtom
            key={version.id}
            variant='outlined'
            aria-pressed={selected.id === version.id}
            className={selected.id === version.id ? styles.selected : ''}
            onClick={() => {
              setLanguage(version.id);
              setCopied('');
            }}>
            {version.label}
          </ButtonAtom>
        ))}
      </div>
      <h3>{selected.title}</h3>
      <p ref={script} className={styles.script}>
        {selected.script}
      </p>
      <div className={styles.actions}>
        <ButtonAtom variant='outlined' onClick={() => void copy()}>
          {selected.kind === 'voice' ? 'Kopiuj tekst' : 'Kopiuj napisy'}
        </ButtonAtom>
        <a
          href={devFilmUrl(selected.download)}
          download
          className={styles.link}>
          Pobierz {selected.kind === 'voice' ? 'TXT' : 'SRT'}
        </a>
      </div>
      <p role='status' className={styles.copyStatus}>
        {copied}
      </p>
      <details className={styles.timings}>
        <summary>Czasy do montażu</summary>
        <p>{data.timingNote}</p>
        <table>
          <thead>
            <tr>
              <th scope='col'>Sekundy</th>
              <th scope='col'>Tekst</th>
            </tr>
          </thead>
          <tbody>
            {selected.cues.map(cue => (
              <tr key={cue.start}>
                <td>
                  {Math.floor(cue.start)} do {Math.ceil(cue.end)} s
                </td>
                <td>{cue.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export function DevFilmsPageComposition() {
  const [data, setData] = useState<DevFilmsManifest | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setError(false);
    void fetch(devFilmUrl('manifest.json'), {
      signal: abort.signal,
      cache: 'no-store',
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error('Local films unavailable');
        }
        const result = (await response.json()) as DevFilmsManifest;
        if (
          result.version !== 1 ||
          result.films?.length !== 2 ||
          result.voiceovers?.length !== 3
        ) {
          throw new Error('Invalid local film manifest');
        }
        setData(result);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setError(true);
        }
      });
    return () => abort.abort();
  }, [attempt]);
  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <AppLinkAtom href='/dev' className={styles.link}>
          Narzędzia deweloperskie
        </AppLinkAtom>
        <header className={styles.heading}>
          <h1>Filmy Nailfolio</h1>
          <p>
            Bieżący montaż i zachowany instruktaż. Wszystko do spokojnego
            odsłuchu i przygotowania lektora w jednym miejscu.
          </p>
        </header>
        {!data && !error && <p role='status'>Wczytywanie filmów…</p>}
        {error && (
          <section className={styles.card}>
            <h2>Materiały lokalne są niedostępne</h2>
            <p>
              Przywróć je poleceniem <code>npm run review:local</code> w
              katalogu filmu, a potem odśwież ten widok.
            </p>
            <ButtonAtom
              variant='outlined'
              onClick={() => setAttempt(value => value + 1)}>
              Spróbuj ponownie
            </ButtonAtom>
          </section>
        )}
        {data && (
          <>
            <div className={styles.films}>
              {data.films.map(film => (
                <Film key={film.id} film={film} />
              ))}
            </div>
            <Voiceover data={data} />
          </>
        )}
      </div>
    </main>
  );
}
