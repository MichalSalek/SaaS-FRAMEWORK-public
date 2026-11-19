// admin/components/ReportCardActions.molecule.tsx
// Moderator decisions for a PENDING report. Benign actions (WARN approve,
// DISMISS reject report, STRIKE) fire at once; destructive ones (HIDE / DELETE
// / BAN) are only STAGED via onStageAction and fire after the confirm dialog.
//
// DECISION: the six actions use the shared buttons: ONE filled (approve, the default decision), the
// rest outlined, destructive ones in the warning outline. All stay on top, nothing hidden in a menu
// (owner). A pending action shows it in ITS button; the others do not react meanwhile.

import { useTranslations } from 'next-intl';
import type { ContentReportItem } from '../hooks/useModerationReports';
import {
  ModerationAction,
  type ModerationAction as ModerationActionType,
} from '@kernel/models/moderation/moderation.dto';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import type { ConfirmableModerationAction } from './ReportActionConfirm.molecule';
import styles from '../AdminModerationPage.module.css';

export function ReportCardActionsMolecule({
  report,
  adminNote,
  resolvingAction,
  isStriking,
  onResolve,
  onStageAction,
  onStrike,
}: {
  report: ContentReportItem;
  adminNote: string;
  /** The decision in flight for THIS report; null when none. */
  resolvingAction: ModerationActionType | null;
  isStriking: boolean;
  onResolve: (action: ModerationActionType, adminNote: string) => void;
  onStageAction: (action: ConfirmableModerationAction) => void;
  onStrike: (userId: string, reason: string) => void;
}) {
  const t = useTranslations('admin.moderation');
  const isResolving = resolvingAction !== null;
  const ownerUserId = report.gallery_record?.gallery_record_owner_user_id;
  // A decision in flight locks the others; its own button shows the wait.
  const lockedUnless = (action: ModerationActionType) =>
    isResolving && resolvingAction !== action;

  return (
    <div className={styles.actionButtons}>
      <ButtonAtom
        size='sm'
        loading={resolvingAction === ModerationAction.WARN}
        disabled={lockedUnless(ModerationAction.WARN)}
        onClick={() => onResolve(ModerationAction.WARN, adminNote)}>
        {t('actionApproveWarn')}
      </ButtonAtom>
      {/* DISMISS = report unfounded → REJECTED, zero side effects on the
          content or its owner. Benign, so like WARN it needs no confirm. */}
      <ButtonAtom
        size='sm'
        variant='outlined'
        loading={resolvingAction === ModerationAction.DISMISS}
        disabled={lockedUnless(ModerationAction.DISMISS)}
        onClick={() => onResolve(ModerationAction.DISMISS, adminNote)}>
        {t('actionDismissReport')}
      </ButtonAtom>
      {ownerUserId != null && (
        <ButtonAtom
          size='sm'
          variant='outlined'
          loading={isStriking}
          onClick={() => {
            // Structured, machine-greppable strike reason persisted to DB:
            // MODERATION_REPORT:<REASON enum> + optional reporter description.
            // No filler literal when the description is absent.
            const description = report.description?.trim();
            onStrike(
              ownerUserId,
              description
                ? `MODERATION_REPORT:${report.reason} | ${description}`
                : `MODERATION_REPORT:${report.reason}`
            );
          }}>
          {t('actionApplyStrike')}
        </ButtonAtom>
      )}
      {/* Actions on the CONTENT only while the gallery record still exists: the relation has onDelete:
          SetNull, so after the photo is deleted (by the owner or an earlier decision) the report lives on
          with gallery_record=null, and „Ukryj"/„Usuń"/„Zablokuj" would aim at nothing. WARN/DISMISS
          stay. */}
      {report.gallery_record !== null && (
        <>
          <ButtonAtom
            size='sm'
            variant='outlined'
            disabled={isResolving}
            onClick={() => onStageAction(ModerationAction.HIDE)}>
            {t('actionHidePhoto')}
          </ButtonAtom>
          <ButtonAtom
            size='sm'
            variant='danger'
            disabled={isResolving}
            onClick={() => onStageAction(ModerationAction.DELETE)}>
            {t('actionDeletePhoto')}
          </ButtonAtom>
          <ButtonAtom
            size='sm'
            variant='danger'
            disabled={isResolving}
            onClick={() => onStageAction(ModerationAction.BAN)}>
            {t('actionBanUser')}
          </ButtonAtom>
        </>
      )}
    </div>
  );
}
