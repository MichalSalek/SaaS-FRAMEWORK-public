// Shared editor for the up-to-three “Links” on a personal or salon profile.
// The stored value is a JSON array of https URLs; the service icon is a
// presentation hint only, so a renamed provider never breaks a saved link.

import { useEffect, useRef, useState } from 'react';
import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { ExternalLinkIconMolecule } from './ExternalLinkIcon.molecule';
import {
  EXTERNAL_LINK_LIMIT,
  detectExternalLinkService,
  formatExternalLinkLabel,
  isValidExternalLink,
  normalizeExternalLink,
  normalizeExternalLinkInput,
  sanitizeExternalLinks,
} from '@kernel/domain/user-and-account/external-links.config';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import styles from './ExternalLinksField.module.css';

export interface ExternalLinksFieldLabels {
  title: string;
  hint: string;
  inputLabel: string;
  add: string;
  remove: string;
  invalid: string;
}

export function ExternalLinksFieldMolecule({
  value,
  onChange,
  onCommit,
  labels,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  onCommit: (next: string[]) => void;
  labels: ExternalLinksFieldLabels;
}) {
  const [error, setError] = useState<{ index: number; message: string } | null>(
    null
  );
  const rows = value.length === 0 ? [''] : value.slice(0, EXTERNAL_LINK_LIMIT);
  // The blur can land in the same React batch as the last keystroke. Commit
  // from the value we already handed to the parent, not from the previous
  // render's prop, or the final pasted link is silently dropped.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current =
      value.length === 0 ? [''] : value.slice(0, EXTERNAL_LINK_LIMIT);
  }, [value]);
  const updateRows = (next: string[]) => {
    rowsRef.current = next;
    onChange(next);
  };

  const commit = () => {
    const normalized = rowsRef.current.map(link =>
      link.trim() === '' ? '' : normalizeExternalLinkInput(link)
    );
    const invalidIndex = normalized.findIndex(
      link => link !== '' && !isValidExternalLink(link)
    );
    if (invalidIndex >= 0) {
      setError({ index: invalidIndex, message: labels.invalid });
      return;
    }
    setError(null);
    const urls = sanitizeExternalLinks(normalized);
    onChange(urls);
    onCommit(urls);
  };

  return (
    <div className={styles.field}>
      <div className={styles.heading}>
        <span className={styles.label}>{labels.title}</span>
        <span className={styles.count}>
          {rows.filter(link => link.trim() !== '').length}/{EXTERNAL_LINK_LIMIT}
        </span>
      </div>
      <p className={styles.hint}>{labels.hint}</p>
      <div className={styles.rows}>
        {rows.map((link, index) => {
          const normalized =
            link.trim() === '' ? null : normalizeExternalLink(link);
          const service = normalized
            ? detectExternalLinkService(normalized)
            : null;
          const serviceLabel =
            service && service.id !== 'website'
              ? service.label
              : normalized
                ? formatExternalLinkLabel(normalized)
                : '';
          return (
            <div className={`${styles.row} micro-enter`} key={index}>
              <span className={styles.serviceIcon} aria-hidden='true'>
                <ExternalLinkIconMolecule url={link} />
              </span>
              <div className={styles.inputWrap}>
                <InputAtom
                  type='text'
                  inputMode='url'
                  aria-label={`${labels.inputLabel} ${index + 1}`}
                  placeholder='https://...'
                  value={link}
                  onChange={e => {
                    const next = [...rowsRef.current];
                    next[index] = e.target.value.slice(0, 300);
                    updateRows(next);
                    if (error?.index === index) {
                      setError(null);
                    }
                  }}
                  onBlur={commit}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                  error={error?.index === index ? error.message : undefined}
                />
                {serviceLabel !== '' && (
                  <span className={styles.serviceLabel}>{serviceLabel}</span>
                )}
              </div>
              {rows.length > 1 && (
                <ButtonAtom
                  type='button'
                  variant='text'
                  size='sm'
                  ariaLabel={labels.remove}
                  className={styles.remove}
                  icon={<XIcon size={16} aria-hidden='true' />}
                  onClick={() => {
                    const next = rowsRef.current.filter((_, i) => i !== index);
                    setError(null);
                    updateRows(next);
                    onCommit(sanitizeExternalLinks(next));
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {rows.length < EXTERNAL_LINK_LIMIT && (
        <ButtonAtom
          type='button'
          variant='text'
          size='sm'
          className={styles.add}
          icon={<PlusIcon size={16} aria-hidden='true' />}
          onClick={() => {
            setError(null);
            updateRows([...rowsRef.current, '']);
          }}>
          {labels.add}
        </ButtonAtom>
      )}
    </div>
  );
}
