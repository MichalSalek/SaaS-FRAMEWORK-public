import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  isPairIntentQuery,
  withoutPairIntent,
} from '../../shared/pairing/pair-intent';

export type ProfilePairIntentAction =
  'wait' | 'consume' | 'redirect' | 'request';

/** A login return opens a confirmation once; redirects keep the intent for the next screen. */
export function useProfilePairIntent(
  action: ProfilePairIntentAction,
  onRequest: () => void
) {
  const router = useRouter();
  const handledPath = useRef<string | null>(null);
  useEffect(() => {
    if (
      !router.isReady ||
      router.query.contact === '1' ||
      !isPairIntentQuery(router.query.pair)
    ) {
      handledPath.current = null;
      return;
    }
    if (action === 'wait' || handledPath.current === router.asPath) {
      return;
    }
    handledPath.current = router.asPath;
    if (action === 'request' || action === 'redirect') {
      onRequest();
    }
    if (action !== 'redirect') {
      void router.replace(withoutPairIntent(router.asPath), undefined, {
        shallow: true,
      });
    }
  }, [action, onRequest, router]);
}
