// admin/ReportCard.organism.tsx
// One content report in the moderation queue: a card with the reported
// picture. The header is the toggle; the details and the decision open in
// place under it (shared disclosure panel).

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CaretDownIcon,
  FlagIcon,
  ImageSquareIcon,
} from '@phosphor-icons/react';
import type { ContentReportItem } from './hooks/useModerationReports';
import {
  ContentReportStatus,
  type ContentReportReason,
  type ModerationAction as ModerationActionType,
} from '@kernel/models/moderation/moderation.dto';
import { getCloudinaryThumbUrl } from '../../../application/cloudinary/cloudinary-url.utils';
import { formatDateTime } from '../../../application/date/date.utils';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { DisclosurePanelAtom } from '../../components/Disclosure/DisclosurePanel.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import {
  ReportActionConfirmMolecule,
  type ConfirmableModerationAction,
} from './components/ReportActionConfirm.molecule';
import { ReportCardActionsMolecule } from './components/ReportCardActions.molecule';
import { ReportCardFactsMolecule } from './components/ReportCardFacts.molecule';
import styles from './AdminModerationPage.module.css';

// Reason enum → i18n label keys. The user-facing labels already exist under
// `moderation.report.reasons.*` (used by ReportModal) — reuse them here instead
// of rendering the raw enum value. Record over the kernel union: TS forces an
// entry (and therefore a label) for every new reason.
const REASON_LABEL_KEY: Record<ContentReportReason, string> = {
  INAPPROPRIATE: 'reasons.inappropriate.label',
  FACE: 'reasons.face.label',
  SPAM: 'reasons.spam.label',
  OTHER: 'reasons.other.label',
};

// Domain map status -> role token; the pill recipe lives in StatusPill.
const STATUS_COLOR: Record<ContentReportStatus, string> = {
  PENDING: 'var(--color-warning)',
  APPROVED: 'var(--color-success)',
  REJECTED: 'var(--color-error)',
};

const STATUS_LABEL_KEY: Record<ContentReportStatus, string> = {
  PENDING: 'statusPending',
  APPROVED: 'statusApproved',
  REJECTED: 'statusRejected',
};

interface ReportCardProps {
  report: ContentReportItem;
  isExpanded: boolean;
  onToggle: () => void;
  onResolve: (action: ModerationActionType, adminNote: string) => void;
  onStrike: (userId: string, reason: string) => void;
  /** The decision in flight for this report; null when none. */
  resolvingAction: ModerationActionType | null;
  isStriking: boolean;
  /** The last decision or strike on this report failed (translated). */
  actionError: string | null;
}

export function ReportCardOrganism({
  report,
  isExpanded,
  onToggle,
  onResolve,
  onStrike,
  resolvingAction,
  isStriking,
  actionError,
}: ReportCardProps) {
  const t = useTranslations('admin.moderation');
  const tReport = useTranslations('moderation.report');
  const lang = useCurrentLang();
  const toggleId = useId();
  const detailId = useId();
  const [adminNote, setAdminNote] = useState('');
  // Thumbnail load-failure guard: a present asset_url can still 404 / be blocked
  // (Cloudinary purge, broken upload). Without this the browser renders the raw
  // alt-text inside a broken-image box. On error we swap to the tonal placeholder
  // tile (same as the no-URL case) — never expose alt-text as visible content.
  const [thumbFailed, setThumbFailed] = useState(false);
  const assetUrl = report.gallery_record?.asset_url;
  // Destructive actions (HIDE/DELETE/BAN) require an explicit confirm step.
  const [pendingAction, setPendingAction] =
    useState<ConfirmableModerationAction | null>(null);
  const isPending = report.status === ContentReportStatus.PENDING;
  const isResolving = resolvingAction !== null;
  // The confirm dialog stays open while its request runs and closes when the
  // request ends in a failure (the reason stands next to the buttons); on
  // success the report leaves the pending state and the card folds.
  useEffect(() => {
    if (actionError !== null) {
      setPendingAction(null);
    }
  }, [actionError]);

  // name is non-null from Prisma (DB default ''), so `?? email` NEVER catches a nameless reporter
  // (magic-link signup before setting a name): the empty string is falsy, not nullish. `.trim() ||`
  // falls through '' → email → fallback (applies to every `??` on a DB-default-'' string).
  // reporter_id is a soft FK (DECISION contentreport-reporter-soft-fk): the report survives account
  // deletion, and then `reporter` arrives as null. That is a DIFFERENT case from an account with no
  // name: the moderator judges credibility differently, so gets „Konto usunięte", not „Anonimowy".
  const reporterName =
    report.reporter === null
      ? t('deletedReporter')
      : report.reporter.name.trim() ||
        report.reporter.email.trim() ||
        t('unknownReporter');
  // An unreadable date shows nothing (the default fallback is a dash).
  const reportedAt = formatDateTime(report.created_at, lang, '');

  // DECISION: the card expands through a NATIVE <button> that wraps the header (thumbnail + info +
  // status); the detail panel is its SIBLING, not its child. A card with role='button' holding a
  // textarea, six buttons and an alertdialog was a control inside a control (invalid ARIA, double
  // tab stop, stopPropagation on every inner element). A click in the details collapses nothing
  // because it is no longer inside the button.
  return (
    <div className={styles.reportCard}>
      <button
        type='button'
        id={toggleId}
        className={styles.reportCardToggle}
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={detailId}
        aria-label={t('reportCardAriaLabel', { reporter: reporterName })}>
        <span className={styles.thumbnailWrap}>
          {assetUrl && !thumbFailed ? (
            <img
              src={getCloudinaryThumbUrl(assetUrl, 200)}
              alt=''
              className={styles.thumbnail}
              loading='lazy'
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <span className={styles.thumbnailPlaceholder}>
              <ImageSquareIcon size={20} weight='light' aria-hidden='true' />
              <span className='sr-only'>{t('thumbnailMissing')}</span>
            </span>
          )}
        </span>

        <span className={styles.reportInfo}>
          <span className={styles.reportReason}>
            {isPending && (
              <span className={styles.reasonIcon} aria-hidden='true'>
                <FlagIcon size={16} weight='fill' />
              </span>
            )}
            <span>{tReport(REASON_LABEL_KEY[report.reason])}</span>
          </span>
          {report.description && (
            // What the reporter wrote: two lines here, whole in the details.
            <span className={styles.reportDescription} data-truncate='content'>
              {report.description}
            </span>
          )}
          <span className={styles.reportMeta}>
            <span>{reporterName}</span>
            {reportedAt !== '' && (
              <time
                className={styles.nowrap}
                dateTime={
                  typeof report.created_at === 'string'
                    ? report.created_at
                    : report.created_at.toISOString()
                }>
                {reportedAt}
              </time>
            )}
          </span>
        </span>

        <span className={styles.reportStatus}>
          <StatusPillAtom
            color={STATUS_COLOR[report.status]}
            label={t(STATUS_LABEL_KEY[report.status])}
          />
          <span
            className={styles.caret}
            data-open={isExpanded}
            aria-hidden='true'>
            <CaretDownIcon size={16} weight='bold' />
          </span>
        </span>
      </button>

      <DisclosurePanelAtom
        id={detailId}
        open={isExpanded}
        labelledBy={toggleId}
        className={styles.detailPanel}>
        {/* The header picture is a 48px mark; the decision needs the picture
            itself. */}
        {assetUrl && !thumbFailed && (
          <img
            src={getCloudinaryThumbUrl(assetUrl, 800)}
            alt={t('reportedContentAlt')}
            className={styles.detailImage}
            loading='lazy'
          />
        )}
        <ReportCardFactsMolecule report={report} reporterName={reporterName} />

        {isPending && (
          <div className={styles.actionPanel}>
            {report.gallery_record === null && (
              <p className={styles.actionNote}>{t('contentGone')}</p>
            )}
            {report.gallery_record?.gallery_record_owner_user_id != null && (
              <StatusPillAtom
                className={styles.ownerStrikes}
                color='var(--color-warning)'
                label={t('ownerActiveStrikes', {
                  count: report.gallery_record.owner_active_strikes,
                })}
              />
            )}
            <InputAtom
              multiline
              rows={3}
              label={t('detailAdminNote')}
              placeholder={t('adminNotePlaceholder')}
              value={adminNote}
              onChange={event => setAdminNote(event.target.value)}
            />
            <ReportCardActionsMolecule
              report={report}
              adminNote={adminNote}
              resolvingAction={resolvingAction}
              isStriking={isStriking}
              onResolve={onResolve}
              onStageAction={setPendingAction}
              onStrike={onStrike}
            />
            {/* Always mounted: a failure appears without moving the buttons. */}
            <p className={styles.actionError} role='alert'>
              {actionError ?? ''}
            </p>
          </div>
        )}
      </DisclosurePanelAtom>

      <ReportActionConfirmMolecule
        action={isPending ? pendingAction : null}
        inProgress={isResolving}
        onConfirm={() => {
          if (pendingAction !== null) {
            onResolve(pendingAction, adminNote);
          }
        }}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
