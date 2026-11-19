import { useTranslations } from 'next-intl';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { PAIR_REQUEST_NOTE_MAX } from '@kernel/domain/pairing/pairing.contract-schemas';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import styles from './PairRequestConfirmDialog.module.css';

export type PairRequestDetails = {
  note: string | null;
};

const emptyToNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * The request form on the public profile. DECISION: the approximate place is
 * resolved by the backend from the trusted edge (Cloudflare city) and never
 * shown or asked for here. The old location button and attribution made the
 * form longer without giving the client a decision she could understand; a
 * missing location never blocks the request. (owner)
 */
export function PairRequestConfirmDialogMolecule({
  stylistName,
  stylistAvatarUrl,
  name,
  onNameChange,
  note,
  onNoteChange,
  nameError,
  saving,
  submitDisabled,
  onSubmit,
  onCancel,
}: {
  stylistName: string;
  stylistAvatarUrl: string | null;
  name: string;
  onNameChange: (value: string) => void;
  note: string;
  onNoteChange: (value: string) => void;
  nameError: string | null;
  saving: boolean;
  submitDisabled: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('stylist.pairRequestConfirm');

  return (
    <form
      id='pair-request-confirm'
      className={styles.form}
      onSubmit={event => {
        event.preventDefault();
        if (!saving && !submitDisabled) {
          onSubmit();
        }
      }}>
      <div className={styles.stylist}>
        <AvatarAtom
          name={stylistName}
          src={stylistAvatarUrl ?? undefined}
          size='md'
          decorative
        />
        <span className={styles.stylistName}>{stylistName}</span>
      </div>

      <div className={styles.benefit}>
        <CheckCircleIcon
          size={22}
          weight='fill'
          className={styles.benefitIcon}
          aria-hidden='true'
        />
        <p className={styles.benefitText}>{t('benefit')}</p>
      </div>

      <InputAtom
        type='text'
        label={t('nameLabel')}
        autoComplete='given-name'
        required
        value={name}
        onChange={event => onNameChange(event.target.value)}
        maxLength={VALIDATION_LENGTHS.NAME_MAX}
        disabled={saving}
        {...(nameError !== null ? { error: nameError } : {})}
      />
      <InputAtom
        label={t('noteLabel')}
        placeholder={t('notePlaceholder')}
        value={note}
        onChange={event => onNoteChange(event.target.value)}
        maxLength={PAIR_REQUEST_NOTE_MAX}
        disabled={saving}
      />
      <div className={styles.actions}>
        <ButtonAtom
          type='button'
          variant='outlined'
          size='md'
          disabled={saving}
          onClick={onCancel}>
          {t('cancel')}
        </ButtonAtom>
        <ButtonAtom
          type='submit'
          form='pair-request-confirm'
          variant='primary'
          size='md'
          disabled={saving || submitDisabled}
          loading={saving}>
          {t('submit')}
        </ButtonAtom>
      </div>
    </form>
  );
}

export { emptyToNull };
