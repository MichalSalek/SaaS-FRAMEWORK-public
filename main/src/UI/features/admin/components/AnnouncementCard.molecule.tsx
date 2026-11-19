// admin/components/AnnouncementCard.molecule.tsx
// One announcement read as a whole: title, what it is now, its type, its
// display window and the full message. Read-only (the preview dialog); the
// list of announcements is a table (AnnouncementsTable).

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { announcementTranslation } from '@kernel/domain/admin/announcement-content';
import {
  getLocaleOrDefault,
  I18N_CONFIG,
  type LocaleType,
} from '@kernel/domain/i18n/i18n.config';
import { formatDateTime } from '../../../../application/date/date.utils';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import { SelectAtom } from '../../../components/Select/Select.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { AnnouncementContentMolecule } from '../../announcements/AnnouncementContent.molecule';
import { AnnouncementSendButtonMolecule } from './AnnouncementSendButton.molecule';
import {
  savedAnnouncementSendState,
  announcementAppRoles,
} from './announcement-send.logic';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import {
  ANNOUNCEMENT_STATUS_LABEL_KEY,
  ANNOUNCEMENT_TYPE_LABEL_KEY,
  deriveStatus,
  formatAnnouncementWindow,
  getAnnouncementStatusColor,
  getAnnouncementTypeColor,
} from './announcement-status.helpers';
import styles from '../AdminAnnouncementsPage.module.css';

interface AnnouncementCardProps {
  announcement: AdminAnnouncement;
  onSend: (announcement: AdminAnnouncement) => void;
  onTest: (announcement: AdminAnnouncement, locale: LocaleType) => void;
}

const LOCALE_LABEL = {
  pl: 'localePl',
  en: 'localeEn',
  de: 'localeDe',
} as const satisfies Record<LocaleType, string>;

export function AnnouncementCardMolecule(props: AnnouncementCardProps) {
  return <AnnouncementCardPreview key={props.announcement.id} {...props} />;
}

function AnnouncementCardPreview({
  announcement,
  onSend,
  onTest,
}: AnnouncementCardProps) {
  const t = useTranslations('admin.announcements');
  const locale = useLocale();
  const [selectedLocale, setSelectedLocale] = useState<LocaleType>(
    getLocaleOrDefault(locale)
  );
  const enabledLocales = I18N_CONFIG.locales.filter(
    language =>
      announcementTranslation(announcement.translations, language) !== undefined
  );
  const previewLocale =
    enabledLocales.find(language => language === selectedLocale) ??
    enabledLocales[0];
  const content =
    previewLocale === undefined
      ? undefined
      : announcementTranslation(announcement.translations, previewLocale);
  const status = deriveStatus(announcement);
  const recipients = [
    ...(announcement.audience_anonymous ? [t('audienceAnonymous')] : []),
    ...announcementAppRoles(announcement).map(role =>
      t(role === 'client' ? 'roleClient' : 'roleStylist')
    ),
  ];
  const sendState = savedAnnouncementSendState(announcement);
  const sentLabel =
    announcement.notification_sent_at !== null
      ? formatDateTime(announcement.notification_sent_at, locale, '')
      : null;

  return (
    <div className={styles.card}>
      {previewLocale !== undefined && (
        <SelectAtom
          label={t('previewLanguage')}
          value={previewLocale}
          options={enabledLocales.map(language => ({
            value: language,
            label: t(LOCALE_LABEL[language]),
          }))}
          onValueChange={setSelectedLocale}
        />
      )}
      <p className={styles.cardTitle} lang={previewLocale}>
        {content?.title ?? announcement.title}
      </p>
      <div className={styles.cardMeta}>
        <StatusPillAtom
          color={getAnnouncementStatusColor(status)}
          label={t(ANNOUNCEMENT_STATUS_LABEL_KEY[status])}
        />
        <StatusPillAtom
          color={getAnnouncementTypeColor(announcement.type)}
          label={t(ANNOUNCEMENT_TYPE_LABEL_KEY[announcement.type])}
          showDot={false}
        />
        <span className={styles.window}>
          {formatAnnouncementWindow(announcement, t)}
        </span>
      </div>
      <div className={styles.recipients}>
        <span>{t('audienceLegend')}:</span>
        {recipients.map((recipient, index) => (
          <span key={recipient} className={styles.recipientGroup}>
            {recipient}
            {index < recipients.length - 1 ? ',' : ''}
          </span>
        ))}
      </div>
      <div className={styles.cardMessage} lang={previewLocale}>
        <AnnouncementContentMolecule
          message={content?.message ?? announcement.message}
        />
      </div>
      <AnnouncementSendButtonMolecule
        state={sendState}
        sentLabel={sentLabel}
        onSend={() => onSend(announcement)}
      />
      {previewLocale !== undefined && content !== undefined && (
        <ButtonAtom
          variant='outlined'
          size='md'
          onClick={() => onTest(announcement, previewLocale)}>
          {t('testToMe')}
        </ButtonAtom>
      )}
    </div>
  );
}
