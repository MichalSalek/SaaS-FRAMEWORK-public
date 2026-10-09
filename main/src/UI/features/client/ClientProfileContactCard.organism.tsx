// UI/features/client/ClientProfileContactCard.organism.tsx
// Contact data the client shares with her connected stylists: two read rows,
// or two fields while she edits.

import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import styles from './ClientProfilePage.module.css';

interface ContactCardProps {
  email: string;
  phone: string;
  isEditing: boolean;
  isSaving: boolean;
  /** Filled only while editing contact data is the main action of the screen
   *  (she has a stylist already); otherwise pairing is, and this is outlined. */
  editIsMainAction: boolean;
  onEmailChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ContactCardOrganism({
  email,
  phone,
  isEditing,
  isSaving,
  editIsMainAction,
  onEmailChange,
  onPhoneChange,
  onEdit,
  onSave,
  onCancel,
}: ContactCardProps) {
  const t = useTranslations('pages.clientProfile');
  const tButtons = useTranslations('buttons');
  const tLabels = useTranslations('labels');
  return (
    <section className={styles.card}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t('contactCardTitle')}</h2>
        <p className={styles.sectionHint}>{t('contactCardSubtitle')}</p>
      </header>

      {/* <form>: Enter in a field saves. */}
      <form
        className={styles.contactForm}
        onSubmit={event => {
          event.preventDefault();
          if (isEditing && !isSaving) {
            onSave();
          }
        }}>
        {isEditing ? (
          <div className={styles.contactFields}>
            <InputAtom
              label={tLabels('email')}
              type='email'
              inputMode='email'
              autoComplete='email'
              autoCapitalize='none'
              autoCorrect='off'
              spellCheck={false}
              value={email}
              placeholder={t('fields.email.placeholder')}
              onChange={event => onEmailChange(event.target.value)}
            />
            <InputAtom
              label={tLabels('phone')}
              type='tel'
              inputMode='tel'
              autoComplete='tel'
              value={phone}
              placeholder={t('fields.phone.placeholder')}
              onChange={event => onPhoneChange(event.target.value)}
            />
          </div>
        ) : (
          <dl className={styles.contactFields}>
            <ContactValue label={tLabels('email')} value={email} />
            <ContactValue label={tLabels('phone')} value={phone} />
          </dl>
        )}

        <div className={styles.contactActions}>
          {isEditing ? (
            <>
              <ButtonAtom
                type='submit'
                variant='primary'
                size='md'
                aria-busy={isSaving}
                disabled={isSaving}>
                {isSaving ? t('saving') : tButtons('save')}
              </ButtonAtom>
              <ButtonAtom
                variant='ghost'
                size='md'
                onClick={onCancel}
                disabled={isSaving}>
                {tButtons('cancel')}
              </ButtonAtom>
            </>
          ) : (
            <ButtonAtom
              variant={editIsMainAction ? 'primary' : 'outlined'}
              size='md'
              onClick={onEdit}>
              {t('editProfile')}
            </ButtonAtom>
          )}
        </div>
      </form>
    </section>
  );
}

function ContactValue({ label, value }: { label: string; value: string }) {
  const t = useTranslations('pages.clientProfile');
  return (
    <div className={styles.contactValueRow}>
      <dt className={styles.contactLabel}>{label}</dt>
      <dd className={value ? styles.contactValue : styles.contactValueEmpty}>
        {value || t('contactNotProvided')}
      </dd>
    </div>
  );
}
