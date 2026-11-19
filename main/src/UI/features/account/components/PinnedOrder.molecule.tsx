import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CaretUpIcon, CaretDownIcon } from '@phosphor-icons/react';
import { getCloudinaryThumbUrl } from '../../../../application/cloudinary/cloudinary-url.utils';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { KeepTogetherTextAtom } from '../../../components/KeepTogetherText/KeepTogetherText.atom';
import {
  usePinnedOrder,
  type PinnedMoveDirection,
} from '../../shared/gallery/hooks/usePinnedOrder';
import { firstBeyondPublicLimit } from './pinnedOrder.helpers';
import styles from './PinnedOrder.module.css';

type FocusTarget = { id: string; direction: PinnedMoveDirection };

/** Ordering makes sense from two works; with one the section is not shown. */
const MIN_RECORDS_TO_ORDER = 2;

interface PinnedOrderProps {
  /** How many pinned works the public profile shows now; `null` = unknown or no limit. */
  publicLimit: number | null;
}

export function PinnedOrderMolecule({ publicLimit }: PinnedOrderProps) {
  const t = useTranslations('account.pinned.order');
  const tButtons = useTranslations('buttons');
  const { records, move, isLoading, isError, isFetching, refetch } =
    usePinnedOrder();
  const [announcement, setAnnouncement] = useState('');
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // After a move focus stays on the same button of the same photo. When the photo reached an edge,
  // that button becomes disabled, so focus moves to the row's other button instead of falling to
  // the top of the page.
  useEffect(() => {
    if (focusTarget === null) {
      return;
    }
    listRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-move-key="${CSS.escape(`${focusTarget.id}:${focusTarget.direction}`)}"]`
      )
      ?.focus();
    setFocusTarget(null);
  }, [focusTarget, records]);

  if (isLoading) {
    return null;
  }

  if (isError && records.length === 0) {
    return (
      <ErrorStateMolecule
        message={t('loadError')}
        retryLabel={tButtons('retry')}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
      />
    );
  }

  if (records.length < MIN_RECORDS_TO_ORDER) {
    return null;
  }

  const total = records.length;
  const beyondFrom = firstBeyondPublicLimit(total, publicLimit);

  const handleMove = (index: number, direction: PinnedMoveDirection) => {
    const record = records[index];
    if (record === undefined || !move(index, direction)) {
      return;
    }
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const atEdge = direction === 'up' ? newIndex === 0 : newIndex === total - 1;
    setFocusTarget({
      id: record.gallery_record_id,
      direction: atEdge ? (direction === 'up' ? 'down' : 'up') : direction,
    });
    setAnnouncement(t('moved', { position: newIndex + 1, total }));
  };

  return (
    <div className={styles.root}>
      <TypographyAtom
        variant='subtitle'
        as='h3'
        id='pinned-order-title'
        className={styles.heading}>
        {t('title')}
      </TypographyAtom>
      <p className={styles.body}>{t('body')}</p>

      <ol
        ref={listRef}
        className={styles.list}
        aria-labelledby='pinned-order-title'>
        {records.map((record, index) => {
          const position = index + 1;
          return (
            <li key={record.gallery_record_id} className={styles.item}>
              {index === beyondFrom && (
                <p className={styles.beyondNote}>
                  <KeepTogetherTextAtom>
                    {t('beyondLimit', { max: beyondFrom })}
                  </KeepTogetherTextAtom>
                </p>
              )}
              <div className={styles.row}>
                <span className={styles.position} aria-hidden='true'>
                  {position}
                </span>
                <img
                  className={styles.thumb}
                  src={getCloudinaryThumbUrl(record.asset_url, 200)}
                  alt=''
                  loading='lazy'
                />
                <div className={styles.actions}>
                  <ButtonAtom
                    data-move-key={`${record.gallery_record_id}:up`}
                    variant='outlined'
                    size='md'
                    icon={<CaretUpIcon size={20} />}
                    ariaLabel={t('moveUp', { position, total })}
                    disabled={index === 0}
                    onClick={() => handleMove(index, 'up')}
                  />
                  <ButtonAtom
                    data-move-key={`${record.gallery_record_id}:down`}
                    variant='outlined'
                    size='md'
                    icon={<CaretDownIcon size={20} />}
                    ariaLabel={t('moveDown', { position, total })}
                    disabled={index === total - 1}
                    onClick={() => handleMove(index, 'down')}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className='sr-only' role='status'>
        {announcement}
      </p>
    </div>
  );
}
