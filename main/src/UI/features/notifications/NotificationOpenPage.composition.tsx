import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  getNotification_IO,
  markNotificationsRead_IO,
} from '../../../domain/notifications/notificationsIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { requestLeave } from '../../../application/routing/leave-guard';
import { useAuth } from '../../contexts/AuthContext.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useSwitchRole } from '../shared/hooks/useSwitchRole';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { notificationTarget } from './notificationOpener.helpers';

function NotificationOpenInner() {
  const t = useTranslations('notifications');
  const buttons = useTranslations('buttons');
  const router = useRouter();
  const { isLoggedIn, accountType } = useAuth();
  const { data: account, isLoading: accountLoading } = useCurrentUserAccount();
  const { mutateAsync: switchRole } = useSwitchRole();
  const queryClient = useQueryClient();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const started = useRef<string | null>(null);
  const activeId = useRef(id);
  const mounted = useRef(false);
  useEffect(() => {
    activeId.current = id;
  }, [id]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const query = useQuery({
    queryKey: [...queryKeys.notifications.all, 'one', id],
    queryFn: ({ signal }) =>
      getNotification_IO({ id }, { signal, silentBusinessError: true }),
    enabled: isLoggedIn && id.length > 0,
    retry: false,
  });
  const notification = query.data?.notification;

  useEffect(() => {
    if (
      !notification ||
      query.isFetching ||
      query.isError ||
      !query.isFetchedAfterMount ||
      !isLoggedIn ||
      accountLoading ||
      account === undefined ||
      !accountType
    ) {
      return;
    }
    const key = `${id}:${attempt}`;
    if (started.current === key) {
      return;
    }
    started.current = key;
    const target = notificationTarget(notification);
    const role = notification.recipient_role;
    if (
      !target ||
      (role === 'CLIENT' && !account?.client_account) ||
      (role === 'STYLIST' && !account?.stylist_account)
    ) {
      setFailed(true);
      return;
    }
    const open = async () => {
      try {
        if (role && role !== accountType) {
          await switchRole({ account_type: role });
        }
        if (!mounted.current || activeId.current !== id) {
          return;
        }
        await markNotificationsRead_IO(
          { notification_id: id, newest_seen_at: notification.created_at },
          { silentBusinessError: true }
        ).catch(() => undefined);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.all,
        });
        if (mounted.current && activeId.current === id) {
          await router.replace(target);
        }
      } catch {
        if (mounted.current && activeId.current === id) {
          setFailed(true);
        }
      }
    };
    if (
      requestLeave(null, () => {
        setFailed(false);
        void open();
      })
    ) {
      void open();
    } else {
      setFailed(true);
    }
  }, [
    notification,
    query.isFetching,
    query.isError,
    query.isFetchedAfterMount,
    isLoggedIn,
    accountLoading,
    account,
    accountType,
    id,
    attempt,
    router,
    switchRole,
    queryClient,
  ]);

  const error =
    router.isReady &&
    (!id || query.isError || (query.data && !notification) || failed);
  return error ? (
    <ErrorStateMolecule
      message={t('loadError')}
      retryLabel={buttons('retry')}
      onRetry={() => {
        setFailed(false);
        void query.refetch().then(result => {
          if (result.data?.notification) {
            setAttempt(value => value + 1);
          }
        });
      }}
    />
  ) : (
    <div aria-busy='true' aria-label={t('title')}>
      <SkeletonAtom variant='rect' width='100%' height={68} />
    </div>
  );
}

export function NotificationOpenPageComposition() {
  const t = useTranslations('notifications');
  return (
    <AppLayoutComposition title={t('title')}>
      <NotificationOpenInner />
    </AppLayoutComposition>
  );
}
