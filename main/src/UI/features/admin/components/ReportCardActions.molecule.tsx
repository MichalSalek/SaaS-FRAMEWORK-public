// admin/components/ReportCardActions.molecule.tsx
// Moderator decisions for a PENDING report. Benign actions (WARN approve,
// DISMISS reject report, STRIKE) fire at once; destructive ones (HIDE / DELETE
// / BAN) are only STAGED via onStageAction and fire after the confirm dialog.
//
// DECISION (nie usuwaj tego komentarza) — S126: sześć akcji stało na sześciu
// własnych przyciskach, każdy z własnym kolorem tła, i trzy z nich były
// wypełnione naraz. Teraz to przyciski wspólne: JEDEN wypełniony (zatwierdzenie,
// decyzja domyślna), reszta obrysowana, a niszczące w obrysie ostrzegawczym.
// Wszystkie zostają na wierzchu (owner: w panelu nic nie chowamy do menu).
// Czekająca akcja pokazuje to W SWOIM przycisku, pozostałe w tym czasie nie
// reagują.

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
      {/* Akcje na TREŚCI tylko, gdy wpis galerii jeszcze istnieje: relacja ma
          onDelete: SetNull, więc po skasowaniu zdjęcia (przez właścicielkę albo
          wcześniejszą decyzję) zgłoszenie żyje dalej z gallery_record=null, a
          „Ukryj"/„Usuń"/„Zablokuj" celowałyby w nic. Zostają WARN/DISMISS. */}
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
