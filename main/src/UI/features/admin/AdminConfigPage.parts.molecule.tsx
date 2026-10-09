// UI/features/admin/AdminConfigPage.parts.molecule.tsx
// One runtime-config row (a setting row: key, one-line description, the value
// editor of its type, its own save) and its skeleton with the same geometry.

import type { useTranslations } from 'next-intl';
import { FloppyDiskIcon } from '@phosphor-icons/react';
import type {
  RuntimeConfigValueType,
  RuntimeConfigEntry,
} from '@kernel/models/admin/admin.dto';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ToggleAtom } from '../../components/Toggle/Toggle.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { SoftBreakTextAtom } from '../../components/SoftBreakText/SoftBreakText.atom';
import styles from './AdminConfigPage.module.css';

/* ─── Type and description keys ─── */

function typeLabelKey(
  type: RuntimeConfigValueType
): 'types.string' | 'types.number' | 'types.boolean' | 'types.json' {
  switch (type) {
    case 'string':
      return 'types.string';
    case 'number':
      return 'types.number';
    case 'boolean':
      return 'types.boolean';
    case 'json':
      return 'types.json';
  }
}

function descriptionKey(
  key: string
):
  | 'descriptions.MAINTENANCE_MESSAGE'
  | 'descriptions.MAINTENANCE_MODE'
  | 'descriptions.PAIRING_SESSION_TTL_MINUTES'
  | 'descriptions.VERBOSE_LOG_MODE'
  | 'descriptions.EVENT_LOG_MAX_AGE_DAYS'
  | 'descriptions.EVENT_LOG_MAX_RECORDS'
  | 'descriptions.STRIPE_EVENT_JANITOR_STALE_MINUTES'
  | 'descriptions.STRIPE_EVENT_JANITOR_MAX_RETRIES'
  | 'descriptions.STRIPE_EVENT_JANITOR_BATCH_SIZE'
  | 'descriptions.API_TIMING_DEBUG_MODE'
  | null {
  switch (key) {
    case 'MAINTENANCE_MESSAGE':
      return 'descriptions.MAINTENANCE_MESSAGE';
    case 'MAINTENANCE_MODE':
      return 'descriptions.MAINTENANCE_MODE';
    case 'PAIRING_SESSION_TTL_MINUTES':
      return 'descriptions.PAIRING_SESSION_TTL_MINUTES';
    case 'VERBOSE_LOG_MODE':
      return 'descriptions.VERBOSE_LOG_MODE';
    case 'EVENT_LOG_MAX_AGE_DAYS':
      return 'descriptions.EVENT_LOG_MAX_AGE_DAYS';
    case 'EVENT_LOG_MAX_RECORDS':
      return 'descriptions.EVENT_LOG_MAX_RECORDS';
    case 'STRIPE_EVENT_JANITOR_STALE_MINUTES':
      return 'descriptions.STRIPE_EVENT_JANITOR_STALE_MINUTES';
    case 'STRIPE_EVENT_JANITOR_MAX_RETRIES':
      return 'descriptions.STRIPE_EVENT_JANITOR_MAX_RETRIES';
    case 'STRIPE_EVENT_JANITOR_BATCH_SIZE':
      return 'descriptions.STRIPE_EVENT_JANITOR_BATCH_SIZE';
    case 'API_TIMING_DEBUG_MODE':
      return 'descriptions.API_TIMING_DEBUG_MODE';
    default:
      return null;
  }
}

/* ─── Skeleton row (the row's final boxes) ─── */

export function ConfigItemSkeletonMolecule() {
  return (
    <li className={styles.row} aria-hidden='true'>
      <div className={styles.text}>
        <SkeletonAtom variant='text' width='60%' height={18} />
        <SkeletonAtom variant='text' width='90%' height={16} />
      </div>
      <div className={styles.editor}>
        <SkeletonAtom variant='rect' width='100%' height={44} />
      </div>
      <div className={styles.action}>
        <SkeletonAtom variant='rect' width={96} height={36} />
        <span className={styles.status} />
      </div>
    </li>
  );
}

/* ─── Single config row ─── */

/** What the row says next to its save button. */
export type ConfigRowStatus = 'idle' | 'dirty' | 'saved' | 'failed';

const STATUS_COLOR: Record<Exclude<ConfigRowStatus, 'idle'>, string> = {
  dirty: 'var(--color-warning)',
  saved: 'var(--color-success)',
  failed: 'var(--color-error)',
};

const STATUS_LABEL_KEY = {
  dirty: 'rowUnsaved',
  saved: 'saved',
  failed: 'rowSaveError',
} as const;

interface ConfigItemProps {
  entry: RuntimeConfigEntry;
  localValue: string;
  status: ConfigRowStatus;
  isDirty: boolean;
  isPending: boolean;
  onValueChange: (id: string, value: string) => void;
  onSave: (entry: RuntimeConfigEntry) => void;
  t: ReturnType<typeof useTranslations<'admin.config'>>;
}

export function ConfigItemMolecule({
  entry,
  localValue,
  status,
  isDirty,
  isPending,
  onValueChange,
  onSave,
  t,
}: ConfigItemProps) {
  // Single-line values save on Enter, like any form field.
  const submitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && isDirty && !isPending) {
      event.preventDefault();
      onSave(entry);
    }
  };
  const descKey = descriptionKey(entry.key);
  const description = descKey ? t(descKey) : entry.description;
  const placeholder =
    entry.key === 'MAINTENANCE_MESSAGE'
      ? t('placeholders.MAINTENANCE_MESSAGE')
      : null;

  return (
    <li className={styles.row}>
      <div className={styles.text}>
        <p className={styles.key}>
          <SoftBreakTextAtom className={styles.keyName}>
            {entry.key}
          </SoftBreakTextAtom>
          {/* The type is a quiet word: the editor already shows it, and the
              old coloured badge gave three colours no meaning. */}
          <span className={styles.type}>
            {t(typeLabelKey(entry.value_type))}
          </span>
        </p>
        {description ? (
          <p className={styles.description}>{description}</p>
        ) : null}
      </div>

      <div className={styles.editor}>
        {entry.value_type === 'boolean' ? (
          <ToggleAtom
            checked={localValue === 'true'}
            onChange={e => onValueChange(entry.id, String(e.target.checked))}
            label={localValue === 'true' ? t('booleanOn') : t('booleanOff')}
            aria-label={entry.key}
          />
        ) : entry.value_type === 'json' ? (
          <InputAtom
            multiline
            rows={3}
            value={localValue}
            onChange={e => onValueChange(entry.id, e.target.value)}
            aria-label={t('ariaJsonValue', { key: entry.key })}
            spellCheck={false}
          />
        ) : (
          <InputAtom
            type='text'
            // A number is typed on the numeric keypad; the value stays a
            // string until the server validates it (InputAtom has no
            // `number` type: reported as a primitive gap).
            {...(entry.value_type === 'number' && { inputMode: 'numeric' })}
            value={localValue}
            onChange={e => onValueChange(entry.id, e.target.value)}
            aria-label={
              entry.value_type === 'number'
                ? t('ariaNumberValue', { key: entry.key })
                : t('ariaStringValue', { key: entry.key })
            }
            onKeyDown={submitOnEnter}
            // An empty text value means something (no banner): say what.
            {...(placeholder !== null && { placeholder })}
            autoCapitalize='none'
            spellCheck={false}
          />
        )}
      </div>

      <div className={styles.action}>
        {/* Always the same button: it waits IN itself and keeps its width.
            Outlined also when changed: several changed rows would otherwise
            put several filled buttons on one screen. */}
        <ButtonAtom
          size='sm'
          variant='outlined'
          icon={<FloppyDiskIcon size={14} />}
          onClick={() => onSave(entry)}
          disabled={!isDirty}
          loading={isPending}
          aria-label={t('ariaSaveEntry', { key: entry.key })}>
          {t('save')}
        </ButtonAtom>
        {/* The result stands next to the button that caused it. The slot is
            always mounted, so a status arriving moves nothing. */}
        <span className={styles.status} role='status'>
          {status !== 'idle' && !isPending && (
            <StatusPillAtom
              color={STATUS_COLOR[status]}
              label={t(STATUS_LABEL_KEY[status])}
            />
          )}
        </span>
      </div>
    </li>
  );
}
