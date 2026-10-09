import { useState } from 'react';
import { useLocale } from 'next-intl';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { SegmentedControlMolecule } from '../../../components/SegmentedControl/SegmentedControl.molecule';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { withPlaygroundVariant } from '../../../../application/playground/playground-variant';
import { withPageTrailingSlash } from '../../../../application/routing/page-href';
import {
  PlaygroundFrameOrganism,
  type PlaygroundMode,
} from './PlaygroundFrame.organism';
import { TODAY_CANDIDATE, type PlaygroundRouteVote } from './playground.types';
import { PlaygroundLoginMolecule } from './PlaygroundLogin.molecule';
import styles from './Playground.module.css';

function candidateSrc(
  vote: PlaygroundRouteVote,
  candidateId: string,
  locale: string
): string {
  const prefix = locale === I18N_CONFIG.defaultLocale ? '' : `/${locale}`;
  const route = withPageTrailingSlash(`${prefix}${vote.route}`);
  return withPlaygroundVariant(
    route,
    vote.id,
    candidateId === TODAY_CANDIDATE.id ? null : candidateId
  );
}

/** One vote: DZIŚ plus candidates on the same live route, side by side. */
export function PlaygroundVoteOrganism({
  vote,
  choice,
  onChoose,
}: {
  vote: PlaygroundRouteVote;
  choice: string | undefined;
  onChoose: (candidateId: string) => void;
}) {
  const locale = useLocale();
  const choices = [TODAY_CANDIDATE, ...vote.candidates];
  const [candidateId, setCandidateId] = useState(TODAY_CANDIDATE.id);
  const [layout, setLayout] = useState<'side' | 'single'>('side');
  const [width, setWidth] = useState(String(vote.widths[0] ?? 390));
  const [mode, setMode] = useState<PlaygroundMode>('light');
  const shown =
    layout === 'side'
      ? choices
      : choices.filter(item => item.id === candidateId);
  const chosenLabel = choices.find(item => item.id === choice)?.label;

  return (
    <section className={styles.vote} aria-labelledby={`${vote.id}-title`}>
      <header className={styles.voteHeader}>
        <h2 id={`${vote.id}-title`}>{vote.title}</h2>
        <p className={styles.question}>{vote.question}</p>
        <p>{vote.finding}</p>
        {vote.prerequisite && (
          <p className={styles.prerequisite}>{vote.prerequisite}</p>
        )}
        {vote.loginAs && <PlaygroundLoginMolecule loginAs={vote.loginAs} />}
      </header>

      <div className={styles.controls}>
        <SegmentedControlMolecule
          ariaLabel='Układ podglądu'
          value={layout}
          onChange={setLayout}
          options={[
            { value: 'side', label: 'Wszystkie obok siebie' },
            { value: 'single', label: 'Po jednym' },
          ]}
        />
        {vote.widths.length > 1 && (
          <SegmentedControlMolecule
            ariaLabel='Szerokość ekranu'
            value={width}
            onChange={setWidth}
            options={vote.widths.map(item => ({
              value: String(item),
              label: `${item} px`,
            }))}
          />
        )}
        <SegmentedControlMolecule
          ariaLabel='Motyw podglądu'
          value={mode}
          onChange={setMode}
          options={[
            { value: 'light', label: 'Jasny' },
            { value: 'dark', label: 'Ciemny' },
          ]}
        />
      </div>

      {layout === 'single' && (
        <SegmentedControlMolecule
          ariaLabel='Wariant'
          value={candidateId}
          onChange={setCandidateId}
          options={choices.map(item => ({ value: item.id, label: item.label }))}
        />
      )}

      <div
        className={styles.frames}
        data-frames
        data-wide={Number(width) >= 1024}>
        {shown.map(candidate => {
          const src = candidateSrc(vote, candidate.id, locale);
          return (
            <article key={candidate.id} className={styles.candidate}>
              <div className={styles.candidateHead}>
                <h3>{candidate.label}</h3>
                <p>{candidate.rationale}</p>
              </div>
              <PlaygroundFrameOrganism
                src={src}
                width={Number(width)}
                mode={mode}
                title={`${vote.title}: ${candidate.label}`}
                loading='eager'
              />
              <div className={styles.candidateActions}>
                <ButtonAtom
                  variant={choice === candidate.id ? 'primary' : 'outlined'}
                  aria-pressed={choice === candidate.id}
                  onClick={() => onChoose(candidate.id)}>
                  {choice === candidate.id
                    ? 'Twój wybór'
                    : `Wybieram ${candidate.label}`}
                </ButtonAtom>
                <a
                  className={styles.link}
                  href={src}
                  target='_blank'
                  rel='noopener noreferrer'>
                  Otwórz osobno ↗
                </a>
              </div>
            </article>
          );
        })}
      </div>
      <p className={styles.status} role='status'>
        {chosenLabel ? `Wybrano: ${chosenLabel}.` : 'Jeszcze bez wyboru.'}
      </p>
    </section>
  );
}
