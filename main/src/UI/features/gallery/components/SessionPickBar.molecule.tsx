// UI/features/gallery/components/SessionPickBar.molecule.tsx
// The bar under the gallery while the client chooses photos for a session:
// how many photos the session holds now and the one way back to it.
//
// DECISION: the gallery no longer throws her back to the session after every photo (see
// useSessionPhotoPicker), so this bar is the exit. It is the screen's one filled button. The count
// stays in the bar, next to the action, because that is where she looks before leaving; with
// nothing chosen yet the same place says what a tap on a photo does.

import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import styles from '../StylistGalleryPage.module.css';

export function SessionPickBarMolecule({
  sessionId,
  pickedCount,
  isReady,
}: {
  /** The session the photos go to; „Gotowe” leads back to it. */
  sessionId: string;
  pickedCount: number;
  /** False until the session's photos are known: the count is not shown as
   *  zero while it is merely unknown. */
  isReady: boolean;
}) {
  const t = useTranslations('pages.gallery.sessionPick');
  const router = useRouter();
  // Back to the session she came from. She arrives here by a push from the
  // session screen, so one step back lands on it with its scroll position;
  // a direct open of this address has no such entry and gets a replace.
  const onDone = () => {
    const historyIndex: unknown = (
      window.history.state as { idx?: unknown } | null
    )?.idx;
    if (typeof historyIndex === 'number' && historyIndex > 0) {
      router.back();
      return;
    }
    void router.replace(
      buildRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, { sessionId })
    );
  };
  return (
    <div className={styles.sessionPickBar}>
      <p className={styles.sessionPickBarText} aria-live='polite'>
        {!isReady
          ? ''
          : pickedCount === 0
            ? t('barEmpty')
            : t('barCount', { count: pickedCount })}
      </p>
      <ButtonAtom variant='primary' size='md' onClick={onDone}>
        {t('barDone')}
      </ButtonAtom>
    </div>
  );
}
