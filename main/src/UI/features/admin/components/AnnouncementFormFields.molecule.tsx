// admin/components/AnnouncementFormFields.molecule.tsx
// Audiences, language slots and the schedule of one announcement.

import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { useTranslations } from 'next-intl';
import { CheckboxAtom } from '../../../components/Checkbox/Checkbox.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { SelectAtom } from '../../../components/Select/Select.atom';
import type { AnnouncementIssue } from './announcement-form.utils';
import {
  ANNOUNCEMENT_LOCALES,
  ANNOUNCEMENT_MESSAGE_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TYPE_OPTIONS,
  allAnnouncementAudiencesSelected,
  announcementPushSoftLocales,
} from './announcement-form.utils';
import type {
  AnnouncementFormState,
  AnnouncementLocaleSlot,
} from './announcement-form.utils';
import styles from './AnnouncementCreateEditDialog.module.css';

const LOCALE_LABEL = {
  pl: 'localePl',
  en: 'localeEn',
  de: 'localeDe',
} as const satisfies Record<LocaleType, string>;

interface AnnouncementFormFieldsProps {
  form: AnnouncementFormState;
  issues: readonly AnnouncementIssue[];
  showErrors: boolean;
  disabled: boolean;
  onChange: (next: AnnouncementFormState) => void;
}

function issueFor(
  issues: readonly AnnouncementIssue[],
  locale: LocaleType,
  code: 'title-empty' | 'title-long' | 'message-empty' | 'message-long'
): boolean {
  return issues.some(
    issue => issue.code === code && 'locale' in issue && issue.locale === locale
  );
}

export function AnnouncementFormFieldsMolecule({
  form,
  issues,
  showErrors,
  disabled,
  onChange,
}: AnnouncementFormFieldsProps) {
  const t = useTranslations('admin.announcements');
  const patch = (next: Partial<AnnouncementFormState>) => {
    onChange({ ...form, ...next });
  };
  const patchLocale = (
    locale: LocaleType,
    next: Partial<AnnouncementLocaleSlot>
  ) => {
    onChange({
      ...form,
      locales: {
        ...form.locales,
        [locale]: { ...form.locales[locale], ...next },
      },
    });
  };
  const languageError = issues.some(issue => issue.code === 'language');
  const audienceError = issues.some(issue => issue.code === 'audience');
  const datesError = issues.some(issue => issue.code === 'dates');
  const pushSoft = announcementPushSoftLocales(form).length > 0;
  const allAudiences = allAnnouncementAudiencesSelected(form);

  const slotError = (
    locale: LocaleType,
    emptyCode: 'title-empty' | 'message-empty',
    longCode: 'title-long' | 'message-long',
    emptyKey: 'validationTitleRequired' | 'validationContentRequired',
    longKey: 'validationTitleTooLong' | 'validationContentTooLong',
    max: number
  ): string | undefined => {
    if (!showErrors) {
      return undefined;
    }
    if (issueFor(issues, locale, emptyCode)) {
      return t(emptyKey);
    }
    if (issueFor(issues, locale, longCode)) {
      return t(longKey, { max });
    }
    return undefined;
  };

  return (
    <>
      <fieldset className={styles.dates}>
        <legend className={styles.datesLegend}>{t('audienceLegend')}</legend>
        <div className={styles.choices}>
          <CheckboxAtom
            className={styles.choice}
            label={t('audienceAll')}
            checked={allAudiences}
            disabled={disabled}
            onChange={event => {
              const checked = event.target.checked;
              patch({
                audience_anonymous: checked,
                audience_client: checked,
                audience_stylist: checked,
              });
            }}
          />
          <CheckboxAtom
            className={styles.choice}
            label={t('audienceAnonymous')}
            checked={form.audience_anonymous}
            disabled={disabled}
            onChange={event =>
              patch({ audience_anonymous: event.target.checked })
            }
          />
          <CheckboxAtom
            className={styles.choice}
            label={t('audienceClient')}
            checked={form.audience_client}
            disabled={disabled}
            onChange={event => patch({ audience_client: event.target.checked })}
          />
          <CheckboxAtom
            className={styles.choice}
            label={t('audienceStylist')}
            checked={form.audience_stylist}
            disabled={disabled}
            onChange={event =>
              patch({ audience_stylist: event.target.checked })
            }
          />
        </div>
        {showErrors && audienceError && (
          <p className={styles.formError} role='alert'>
            {t('validationAudienceRequired')}
          </p>
        )}
      </fieldset>

      <fieldset className={styles.dates}>
        <legend className={styles.datesLegend}>{t('localeLegend')}</legend>
        <p className={styles.datesHint}>{t('linkHint')}</p>
        <div className={styles.choices}>
          {ANNOUNCEMENT_LOCALES.map(locale => (
            <CheckboxAtom
              key={locale}
              className={styles.choice}
              label={t(LOCALE_LABEL[locale])}
              checked={form.locales[locale].enabled}
              disabled={disabled}
              onChange={event =>
                patchLocale(locale, { enabled: event.target.checked })
              }
            />
          ))}
        </div>
        {showErrors && languageError && (
          <p className={styles.formError} role='alert'>
            {t('validationLanguageRequired')}
          </p>
        )}
        {ANNOUNCEMENT_LOCALES.map(locale => {
          const slot = form.locales[locale];
          if (!slot.enabled) {
            return null;
          }
          return (
            <div key={locale} className={styles.slot}>
              <p className={styles.slotLabel}>{t(LOCALE_LABEL[locale])}</p>
              <InputAtom
                label={t('fieldTitle')}
                value={slot.title}
                disabled={disabled}
                onChange={event =>
                  patchLocale(locale, { title: event.target.value })
                }
                error={slotError(
                  locale,
                  'title-empty',
                  'title-long',
                  'validationTitleRequired',
                  'validationTitleTooLong',
                  ANNOUNCEMENT_TITLE_MAX
                )}
              />
              <p className={styles.counter}>
                {t('fieldLength', {
                  count: slot.title.length,
                  max: ANNOUNCEMENT_TITLE_MAX,
                })}
              </p>
              <InputAtom
                multiline
                label={t('fieldContent')}
                value={slot.message}
                disabled={disabled}
                rows={5}
                onChange={event =>
                  patchLocale(locale, { message: event.target.value })
                }
                error={slotError(
                  locale,
                  'message-empty',
                  'message-long',
                  'validationContentRequired',
                  'validationContentTooLong',
                  ANNOUNCEMENT_MESSAGE_MAX
                )}
              />
              <p className={styles.counter}>
                {t('fieldLength', {
                  count: slot.message.length,
                  max: ANNOUNCEMENT_MESSAGE_MAX,
                })}
              </p>
            </div>
          );
        })}
        {pushSoft && <p className={styles.datesHint}>{t('pushSoftWarning')}</p>}
      </fieldset>

      <SelectAtom
        label={t('fieldType')}
        value={form.type}
        disabled={disabled}
        onChange={event => {
          const picked = ANNOUNCEMENT_TYPE_OPTIONS.find(
            option => option.value === event.target.value
          );
          if (picked !== undefined) {
            patch({ type: picked.value });
          }
        }}
        options={ANNOUNCEMENT_TYPE_OPTIONS.map(option => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
      />

      <fieldset className={styles.dates}>
        <legend className={styles.datesLegend}>{t('fieldDateRange')}</legend>
        <div className={styles.datesRow}>
          <InputAtom
            type='date'
            className={styles.dateField}
            label={t('fieldStartDate')}
            value={form.starts_at}
            disabled={disabled}
            onChange={event => patch({ starts_at: event.target.value })}
            aria-invalid={showErrors && datesError}
          />
          <InputAtom
            type='date'
            className={styles.dateField}
            label={t('fieldEndDate')}
            value={form.ends_at}
            disabled={disabled}
            onChange={event => patch({ ends_at: event.target.value })}
            aria-invalid={showErrors && datesError}
          />
        </div>
        <p className={styles.datesHint}>{t('fieldDateRangeHint')}</p>
        {showErrors && datesError && (
          <p className={styles.formError} role='alert'>
            {t('validationDatesOrder')}
          </p>
        )}
      </fieldset>

      <CheckboxAtom
        className={styles.choice}
        label={t('fieldVisibilityActive')}
        checked={form.is_active}
        disabled={disabled}
        onChange={event => patch({ is_active: event.target.checked })}
      />
    </>
  );
}
