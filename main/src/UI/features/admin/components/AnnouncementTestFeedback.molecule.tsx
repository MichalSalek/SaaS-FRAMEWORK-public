import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';
import { OutcomeStateMolecule } from '../../../components/OutcomeFeedback/OutcomeState.molecule';
import { announcementTestPushFeedback } from './announcement-test-feedback.logic';
import styles from '../AdminAnnouncementsPage.module.css';

export type AnnouncementTestResult =
  ADMIN_DTO_API_V1['ADMIN_TEST_ANNOUNCEMENT_NOTIFICATION']['RESPONSE'];

export function AnnouncementTestFeedbackMolecule({
  result,
  anchorRef,
}: {
  result: AnnouncementTestResult | null;
  anchorRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations('admin.announcements');
  if (result === null) {
    return null;
  }
  const push = announcementTestPushFeedback(result.push);
  return (
    <div className={styles.card} ref={anchorRef} tabIndex={-1}>
      <OutcomeStateMolecule
        confirmed
        animateOnConfirm
        completionKey={result.notification_id}
        message={t('testAdded')}
      />
      <CompletionLineMolecule state={push.state} message={t(push.key)} />
      <LinkButtonAtom
        href={ROUTES_FRONT.NOTIFICATIONS}
        variant='outlined'
        size='md'>
        {t('testOpenNotifications')}
      </LinkButtonAtom>
    </div>
  );
}
