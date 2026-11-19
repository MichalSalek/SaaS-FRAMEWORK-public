import { useTranslations } from 'next-intl';
import { BrandMarkAtom } from '../../components/BrandMark/BrandMark.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import type { NativeEntryStartupPhase } from './useNativeEntryBootstrapReadiness';
import styles from './NativeEntryBootstrap.composition.module.css';

type NativeEntryBootstrapStatusProps = {
  phase: NativeEntryStartupPhase;
  isRetrying: boolean;
  onRetry: () => void;
};

export function NativeEntryBootstrapStatusComposition({
  phase,
  isRetrying,
  onRetry,
}: NativeEntryBootstrapStatusProps) {
  const tEvents = useTranslations('events');
  const tErrors = useTranslations('errors');
  const tA11y = useTranslations('a11y');

  return (
    <div
      className={styles.root}
      aria-busy={phase === 'checking'}
      aria-live={phase === 'checking' ? 'polite' : undefined}>
      <BrandMarkAtom label='Nailfolio' className={styles.mark} sizes='72px' />
      {phase === 'unavailable' ? (
        <ErrorStateMolecule
          message={tEvents('AUTH_UNAVAILABLE')}
          retryLabel={tErrors('tryAgain')}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      ) : (
        <>
          <span className={styles.spinner} aria-hidden='true' />
          <span className={styles.visuallyHidden} role='status'>
            {tA11y('loading')}
          </span>
        </>
      )}
    </div>
  );
}
