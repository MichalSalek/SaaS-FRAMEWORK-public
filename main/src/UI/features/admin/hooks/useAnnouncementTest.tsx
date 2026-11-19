import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { announcementTranslation } from '@kernel/domain/admin/announcement-content';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { adminTestAnnouncementNotification_IO } from '../../../../domain/admin/announcements/adminAnnouncementsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { AdminAnnouncement } from './useAdminAnnouncements';
import {
  AnnouncementTestConfirmDialogMolecule,
  type AnnouncementTestTarget,
} from '../components/AnnouncementTestConfirmDialog.molecule';
import {
  AnnouncementTestFeedbackMolecule,
  type AnnouncementTestResult,
} from '../components/AnnouncementTestFeedback.molecule';

type TestRequest =
  ADMIN_DTO_API_V1['ADMIN_TEST_ANNOUNCEMENT_NOTIFICATION']['REQUEST'];

export function useAnnouncementTest() {
  const t = useTranslations('admin.announcements');
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<AnnouncementTestTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnnouncementTestResult | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const mutation = useMutation({
    mutationFn: (request: TestRequest) =>
      adminTestAnnouncementNotification_IO(request),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    },
  });
  const request = (announcement: AdminAnnouncement, locale: LocaleType) => {
    if (
      mutation.isPending ||
      announcementTranslation(announcement.translations, locale) === undefined
    ) {
      return;
    }
    setError(null);
    setResult(null);
    setTarget({ announcement, locale });
  };
  const confirm = () => {
    if (target === null || mutation.isPending) {
      return;
    }
    setError(null);
    mutation.mutate(
      { id: target.announcement.id, locale: target.locale },
      {
        onSuccess: receipt => {
          setResult(receipt);
          setTarget(null);
        },
        onError: () => setError(t('testError')),
      }
    );
  };
  return {
    request,
    clear: () => setResult(null),
    feedback: (
      <AnnouncementTestFeedbackMolecule result={result} anchorRef={resultRef} />
    ),
    dialog: (
      <AnnouncementTestConfirmDialogMolecule
        target={target}
        errorMessage={error}
        isSending={mutation.isPending}
        resultFocus={result === null ? undefined : resultRef}
        onConfirm={confirm}
        onCancel={() => {
          if (!mutation.isPending) {
            setTarget(null);
            setError(null);
          }
        }}
      />
    ),
  };
}
