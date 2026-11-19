import { SuccessSceneOrganism } from '../../components/OutcomeFeedback/SuccessScene.organism';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { acceptSalonInvitationToken_IO } from '../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { flowErrorCode } from '../shared/analytics/flowErrorCode';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import styles from './SalonInvitationAcceptPage.module.css';

type Result = SALON_STAFF_DTO_API_V1['SALON_STAFF_ACCEPT_TOKEN']['RESPONSE'];

const traceAnswer = (answer: Result): Result => {
  trackFlowStep(
    'salon_team',
    answer.status === 'ACCEPTED'
      ? 'invitation_accepted'
      : 'invitation_declined',
    { via: 'email_link' }
  );
  return answer;
};

export function SalonInvitationAcceptPageComposition() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('salon.accept');
  const started = useRef<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const token =
    typeof router.query['token'] === 'string' ? router.query['token'] : null;
  const respond = async (response: 'ACCEPT' | 'DECLINE') => {
    if (!token || busy) {
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const answer = await acceptSalonInvitationToken_IO(
        { token, response },
        { silentBusinessError: true }
      );
      setResult(traceAnswer(answer));
    } catch (failure) {
      trackFlowStep('salon_team', 'failed', {
        action: 'respond_invitation',
        via: 'email_link',
        code: flowErrorCode(failure),
      });
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!router.isReady || !token || started.current === token) {
      return;
    }
    started.current = token;
    // DECISION: the email click accepts the invitation only. This endpoint cannot create a session;
    // normal login retains its confirmation gate.
    setBusy(true);
    void acceptSalonInvitationToken_IO(
      { token, response: 'ACCEPT' },
      { silentBusinessError: true }
    )
      .then(answer => setResult(traceAnswer(answer)))
      .catch((failure: unknown) => {
        trackFlowStep('salon_team', 'failed', {
          action: 'respond_invitation',
          via: 'email_link',
          code: flowErrorCode(failure),
        });
        setError(true);
      })
      .finally(() => setBusy(false));
  }, [router.isReady, token]);
  useEffect(() => {
    if (result) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
    }
  }, [result, queryClient]);
  const loginHref = result
    ? `${ROUTES_FRONT.USER_LOG}?email=${encodeURIComponent(result.email)}&role=stylist&from=${encodeURIComponent(ROUTES_FRONT.SALON_STAFF)}`
    : ROUTES_FRONT.USER_LOG;
  return (
    <PublicLayoutComposition>
      <Head>
        <title>{t('title')}</title>
        <meta name='robots' content='noindex,nofollow' />
        <meta name='referrer' content='no-referrer' />
      </Head>
      <main className={styles.page}>
        {!router.isReady || busy ? (
          <div role='status'>
            <h1>{t('loading')}</h1>
            <SkeletonAtom variant='text' width='100%' />
          </div>
        ) : error || !token ? (
          <ErrorStateMolecule
            message={t('error')}
            retryLabel={t('retry')}
            onRetry={() => void respond('ACCEPT')}
          />
        ) : result ? (
          result.status === 'ACCEPTED' ? (
            <SuccessSceneOrganism
              title={t('accepted', { salon: result.salon_name })}
              body={t(
                result.requires_stylist_account ? 'registerBody' : 'loginBody'
              )}
              aside={<p>{t('galleryNotice')}</p>}
              actions={
                <>
                  <LinkButtonAtom href={loginHref} variant='primary'>
                    {t('continue')}
                  </LinkButtonAtom>
                  <ButtonAtom
                    variant='text'
                    onClick={() => void respond('DECLINE')}>
                    {t('decline')}
                  </ButtonAtom>
                </>
              }
            />
          ) : (
            <>
              <h1>{t('declined')}</h1>
              <p>{t('declinedBody')}</p>
              <LinkButtonAtom href={loginHref} variant='primary'>
                {t('continue')}
              </LinkButtonAtom>
            </>
          )
        ) : null}
      </main>
    </PublicLayoutComposition>
  );
}
