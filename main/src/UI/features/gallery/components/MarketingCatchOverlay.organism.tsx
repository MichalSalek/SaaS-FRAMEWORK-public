import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';
import styles from './MarketingCatchOverlay.module.css';

interface MarketingCatchOverlayProps {
  isPending: boolean;
  status: 'idle' | 'pending' | 'complete' | 'error';
  onOptIn: () => void;
  onDismiss: () => void;
}

/** Optional consent stays below the publication actions and never owns navigation. */
export function MarketingCatchOverlayOrganism({
  isPending,
  status,
  onOptIn,
  onDismiss,
}: MarketingCatchOverlayProps) {
  const t = useTranslations('pages.gallery');
  const common = useTranslations('components.outcomeFeedback');
  return (
    <div className={styles.content}>
      <p className={styles.body}>{t('marketingCatchBody')}</p>
      <div className={styles.actions}>
        <ButtonAtom
          variant='outlined'
          size='md'
          onClick={onOptIn}
          disabled={isPending || status === 'complete'}
          loading={isPending}>
          {t('marketingCatchOptIn')}
        </ButtonAtom>
        {status !== 'complete' && (
          <ButtonAtom variant='text' size='md' onClick={onDismiss}>
            {t('marketingCatchDismiss')}
          </ButtonAtom>
        )}
      </div>
      <CompletionLineMolecule
        state={status === 'idle' ? 'idle' : status}
        message={
          status === 'pending'
            ? common('marketingOptInPending')
            : status === 'complete'
              ? common('marketingOptInDone')
              : status === 'error'
                ? common('marketingOptInFailed')
                : ''
        }
        reserveMessage={common('marketingOptInFailed')}
      />
    </div>
  );
}
