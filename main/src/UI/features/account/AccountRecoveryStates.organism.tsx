// UI/features/account/AccountRecoveryStates.organism.tsx
// The two short states of the recovery screen (signed out, account active)
// and its loading state. Each short state is one sentence under the screen
// intro and ONE action; the wait is a skeleton with the final geometry.

import type { ReactNode } from 'react';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import styles from './AccountRecoveryPage.module.css';

interface RecoveryNoticeProps {
  body: string;
  /** The one action of the state. */
  action: ReactNode;
}

export function RecoveryNoticeOrganism({ body, action }: RecoveryNoticeProps) {
  const lang = useCurrentLang();
  return (
    <>
      <p className={styles.lead} lang={lang}>
        {body}
      </p>
      <div className={styles.actions}>{action}</div>
    </>
  );
}

/** Intro, one line of text, the action. */
export function RecoveryCheckingOrganism() {
  return (
    <div className={styles.checking} aria-busy='true'>
      <SkeletonAtom variant='rect' width='100%' height={96} />
      <SkeletonAtom variant='rect' width='90%' height={24} />
      <SkeletonAtom variant='rect' width={200} height={48} />
    </div>
  );
}
