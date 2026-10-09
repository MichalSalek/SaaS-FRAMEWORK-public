// Leave-guard host, mounted once in `_app` next to the navigation controller:
//   1. renders the ONE "leave without saving?" dialog (AppDialogAtom) for the
//      prompt held by application/routing/leave-guard.ts;
//   2. installs the push/replace seam on the real Next router instance, the
//      only place every push-origin navigation passes through (AppLinkAtom,
//      useNativeRouter after its own pre-check, raw router.push/replace,
//      redirections.ts). Mechanism: DECISION in leave-guard.ts.
// Router EVENTS stay with NavigationTransitionController (O18); this file
// never subscribes to them.

import { useEffect, useSyncExternalStore } from 'react';
import Router from 'next/router';
import { useTranslations } from 'next-intl';
import { AppDialogAtom } from '../primitives/AppDialog.atom';
import { ButtonAtom } from '../components/Button/Button.atom';
import {
  getLeavePrompt,
  requestLeave,
  resolveLeavePrompt,
  resolveTargetPathname,
  subscribeLeavePrompt,
} from '../../application/routing/leave-guard';

type NextRouterInstance = NonNullable<(typeof Router)['router']>;

function installRouterSeam(router: NextRouterInstance): () => void {
  const originalPush = router.push.bind(router);
  const originalReplace = router.replace.bind(router);

  router.push = (url, as, options) => {
    const target = resolveTargetPathname(as ?? url, window.location.pathname);
    if (!requestLeave(target, () => void originalPush(url, as, options))) {
      return Promise.resolve(false);
    }
    return originalPush(url, as, options);
  };
  router.replace = (url, as, options) => {
    const target = resolveTargetPathname(as ?? url, window.location.pathname);
    if (!requestLeave(target, () => void originalReplace(url, as, options))) {
      return Promise.resolve(false);
    }
    return originalReplace(url, as, options);
  };

  return () => {
    router.push = originalPush;
    router.replace = originalReplace;
  };
}

export function LeaveGuardDialogComposition() {
  const t = useTranslations('components.leaveGuard');
  const tButtons = useTranslations('buttons');
  const prompt = useSyncExternalStore(
    subscribeLeavePrompt,
    getLeavePrompt,
    () => null
  );

  useEffect(() => {
    const router = Router.router;
    if (router === null) {
      return;
    }
    return installRouterSeam(router);
  }, []);

  const isDiscard = prompt?.kind === 'discard';

  return (
    <AppDialogAtom
      open={prompt !== null}
      onOpenChange={open => {
        if (!open) {
          resolveLeavePrompt('cancel');
        }
      }}>
      {prompt !== null && (
        <AppDialogAtom.Content
          title={isDiscard ? t('titleDiscard') : t('titleLeave')}
          description={prompt.message}>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='outlined'
              size='md'
              onClick={() => resolveLeavePrompt('confirm')}>
              {isDiscard ? t('discard') : t('leave')}
            </ButtonAtom>
            <ButtonAtom
              variant='primary'
              size='md'
              onClick={() => resolveLeavePrompt('cancel')}>
              {isDiscard ? tButtons('cancel') : t('stay')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      )}
    </AppDialogAtom>
  );
}
