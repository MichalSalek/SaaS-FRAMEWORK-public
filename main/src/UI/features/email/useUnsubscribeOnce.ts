import { useEffect, type RefObject } from 'react';
import type { NextRouter } from 'next/router';
import type { useTranslations } from 'next-intl';

type UnsubscribeOnceInput = {
  router: NextRouter;
  hasFired: RefObject<boolean>;
  runUnsubscribe: (token: string) => void;
  onNoToken: () => void;
  /** Kept in the dependencies as before: a locale change re-checks the token (still fire-once). */
  t: ReturnType<typeof useTranslations<'pages.emailUnsubscribe'>>;
};

/** Fires the unsubscribe request once, as soon as the router knows the token. */
export function useUnsubscribeOnce({
  router,
  hasFired,
  runUnsubscribe,
  onNoToken,
  t,
}: UnsubscribeOnceInput): void {
  // DECISION: fire-once unsubscribe gated by the hasFired ref. Adding runUnsubscribe to deps
  // would risk a re-fire if its identity changes; the fire-once intent is the contract. This file
  // is the one place `react-hooks/exhaustive-deps` is off for it (main/eslint.config.mjs), and
  // 'use no memo' keeps the React Compiler from compiling around the omission.
  'use no memo';
  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    const token = router.query['token'];
    const tokenStr = Array.isArray(token) ? token[0] : token;

    if (!tokenStr) {
      onNoToken();
      return;
    }

    if (hasFired.current) {
      return;
    }
    hasFired.current = true;

    runUnsubscribe(tokenStr);
  }, [router.isReady, router.query, t]);
}
