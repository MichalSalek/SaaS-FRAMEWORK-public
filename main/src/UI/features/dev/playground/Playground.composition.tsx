import { useEffect, useState } from 'react';
import {
  getLocalStorage,
  setLocalStorage,
} from '../../../../application/client-device-storage/local-storage-adapter/localStorage.adapter';
import { STORAGE_KEYS } from '../../../../application/client-device-storage/storage-keys.config';
import { PlaygroundVoteOrganism } from './PlaygroundVote.organism';
import { RouteCensusMolecule } from './RouteCensus.molecule';
import { OPEN_PLAYGROUND_VOTES } from './playground.votes';
import {
  parsePlaygroundVotes,
  removeStoredPlaygroundVote,
  summarizePlaygroundVotes,
  type PlaygroundVotes,
} from './playgroundVotes.storage';
import styles from './Playground.module.css';

/**
 * /dev/playground — the owner-vote workshop (dev and staging only).
 *
 * Every candidate is the LIVE product route in a same-origin frame, with
 * `?pg=<vote>:<candidate>` switching one branch in the product component
 * (`usePlaygroundVariant`). DZIŚ is the same route without the parameter, so
 * both run on identical data, session, locale and viewport width.
 *
 * Closed votes are removed from the registry once applied; git keeps the history.
 */
export function PlaygroundComposition() {
  const votes = OPEN_PLAYGROUND_VOTES;
  const [choices, setChoices] = useState<PlaygroundVotes>({});
  const [storageFailed, setStorageFailed] = useState(false);

  useEffect(() => {
    const stored = getLocalStorage(STORAGE_KEYS.PLAYGROUND_VOTES);
    const cleaned = removeStoredPlaygroundVote(
      removeStoredPlaygroundVote(stored, 's125-paleta'),
      'dashboard-accents'
    );
    if (cleaned !== stored && cleaned !== null) {
      try {
        setLocalStorage(STORAGE_KEYS.PLAYGROUND_VOTES, cleaned);
      } catch {
        setStorageFailed(true);
      }
    }
    setChoices(parsePlaygroundVotes(cleaned, votes));
  }, [votes]);

  const choose = (voteId: string, candidateId: string) => {
    const next = { ...choices, [voteId]: candidateId };
    setChoices(next);
    try {
      setLocalStorage(STORAGE_KEYS.PLAYGROUND_VOTES, JSON.stringify(next));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  };

  const summary = summarizePlaygroundVotes(choices, votes);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.kicker}>Playground</p>
        <h1 className={styles.title}>
          {votes.length === 0
            ? 'Brak otwartych głosowań'
            : `Otwarte głosowania: ${votes.length}`}
        </h1>
        <p className={styles.lede}>
          {votes.length === 0
            ? 'Ta strona hostuje warianty wtedy, gdy decyzja gustu czeka na rozstrzygnięcie. Po każdym głosie warianty znikają, żeby nikt nie głosował nad tym, co już stoi na produkcji.'
            : 'Każdy wariant to żywa strona produktu na tych samych danych co DZIŚ. Możesz przewijać i klikać wewnątrz ramki. Wybór zapisuje się tylko w tej przeglądarce i niczego nie wdraża.'}
        </p>
      </header>

      {votes.map(vote => (
        <PlaygroundVoteOrganism
          key={vote.id}
          vote={vote}
          choice={choices[vote.id]}
          onChoose={candidateId => choose(vote.id, candidateId)}
        />
      ))}

      {votes.length > 0 && (
        <section className={styles.summary} aria-label='Podsumowanie wyborów'>
          <h2>
            Twoje wybory ({Object.keys(choices).length}/{votes.length})
          </h2>
          <p>
            {storageFailed
              ? 'Przeglądarka nie zapisała wyboru. Skopiuj podsumowanie poniżej.'
              : 'Skopiuj podsumowanie do rozmowy. Dopiero wtedy wdrożymy zwycięzców.'}
          </p>
          <textarea
            aria-label='Podsumowanie do skopiowania'
            readOnly
            value={summary || 'Nie wybrano jeszcze wariantów.'}
            rows={Math.max(3, votes.length)}
          />
        </section>
      )}

      <details className={styles.details}>
        <summary>Mapa ekranów z routingu</summary>
        <RouteCensusMolecule />
      </details>
    </main>
  );
}
