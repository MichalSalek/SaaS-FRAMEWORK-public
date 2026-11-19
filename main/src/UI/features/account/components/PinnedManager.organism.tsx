// UI/features/account/components/PinnedManager.organism.tsx
// Menedżer przypiętych prac — jedno miejsce, w którym stylistka decyduje, CO
// widzi klientka na publicznym profilu.
//
// DECISION: this view exists because pinning used to be possible ONLY from a single photo's detail
// (/app/photo/[id]), so the feature sold on the pricing page ("3 → 10 → 15 → 30 → 50 pinned") had
// no visible surface in the product. It shows the whole gallery at once, the pin state on the tile
// and the limit counter. The limit and counter come from usage-stats (the plan SSOT), not from the
// list length: the list is paginated and would show "pinned 2" when there are really 12.
// (owner)

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PushPinIcon, ImagesIcon } from '@phosphor-icons/react';
import { getCloudinaryThumbUrl } from '../../../../application/cloudinary/cloudinary-url.utils';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import {
  flattenGalleryPages,
  useOwnGallery,
} from '../../shared/gallery/hooks/useOwnGallery';
import { useTogglePin } from '../../shared/gallery/hooks/useTogglePin';
import { useUsageStats } from '../../shared/account/hooks/useUsageStats';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  getQuotaFailureFeature,
  resolveQuotaSnapshot,
} from '../../../../application/pricing/quota.helpers';
import { isIOError } from '../../../../application/http/io';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { QuotaNoticeMolecule } from '../../shared/upsell/QuotaNotice.molecule';
import { QuotaUpgradeDialogOrganism } from '../../shared/upsell/QuotaUpgradeDialog.organism';
import { useQuotaTranslations } from '../../shared/upsell/quotaTranslations';
import { PinnedOrderMolecule } from './PinnedOrder.molecule';
import styles from './PinnedManager.module.css';

interface PinTileProps {
  galleryRecordId: string;
  assetUrl: string;
  isPinned: boolean;
  pinLabel: string;
  unpinLabel: string;
  onActionError: (error: unknown, wasPinned: boolean) => void;
}

function PinTile({
  galleryRecordId,
  assetUrl,
  isPinned,
  pinLabel,
  unpinLabel,
  onActionError,
}: PinTileProps) {
  const togglePin = useTogglePin(galleryRecordId, { onError: onActionError });
  const disabled = togglePin.isPending;

  return (
    <li>
      {/* The whole tile toggles the pin (a 36px corner button would be below
          the 44px touch floor). The pin is only a state indicator. */}
      <button
        type='button'
        className={`${styles.tile} press-feedback`}
        aria-pressed={isPinned}
        aria-label={isPinned ? unpinLabel : pinLabel}
        disabled={disabled}
        onClick={() => togglePin.mutate(isPinned)}>
        <img
          className={styles.thumb}
          src={getCloudinaryThumbUrl(assetUrl, 400)}
          alt=''
          loading='lazy'
        />
        {/* Stan niesie WAGA glifu (fill = przypięte), nie inny glif: przekreślona
            pinezka na kaflu NIEprzypiętym mówiła „odepnij" dokładnie tam, gdzie
            kliknięcie przypina. */}
        <span className={styles.pinBadge} aria-hidden='true'>
          <PushPinIcon size={16} weight={isPinned ? 'fill' : 'regular'} />
        </span>
      </button>
    </li>
  );
}

export function PinnedManagerOrganism() {
  const t = useTranslations('account.pinned');
  const tCopy = useQuotaTranslations();
  const tButtons = useTranslations('buttons');
  const [quotaUpgradeOpen, setQuotaUpgradeOpen] = useState(false);
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useOwnGallery();
  const { data: usage } = useUsageStats();
  const { data: currentUser } = useCurrentUserAccount();

  const records = flattenGalleryPages(data);
  const pinnedCount = usage?.pinned_records;
  const maxPinned = usage?.limits.max_pinned_records;
  const quota = resolveQuotaSnapshot(pinnedCount, maxPinned);
  const currentPlan = currentUser?.stylist_account
    ? getEffectivePricingPlan(currentUser.stylist_account)
    : PricingPlanValue.FREE;

  const handlePinError = (error: unknown, wasPinned: boolean) => {
    const errorCode = flowErrorCode(error);
    const feature = getQuotaFailureFeature(
      'pinned',
      errorCode,
      isIOError(error) ? error.httpError.data : undefined
    );
    if (feature === 'pinned') {
      setQuotaUpgradeOpen(true);
      return;
    }
    if (!wasPinned && errorCode.startsWith('GALLERY')) {
      pushNewSnackbar(tCopy('components.quotaUpgrade.actionFailed'), 'error');
    }
  };

  return (
    <section className={styles.section} aria-labelledby='pinned-manager-title'>
      {/* DECISION: at 360px the counter "Przypięte 6 z 30" took a row, the title wrapped to two lines
          and the pin hung between them. The counter is now just "6 z 30" (the title already carries
          "Przypięte") as ONE unbreakable piece; the icon and title form a pair that does not break,
          so in a tight row the WHOLE counter drops below, never half a title. The counter is always
          mounted (empty until usage loads) so the header does not twitch when the numbers arrive.
          (owner) */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.titleIcon} aria-hidden='true'>
            <PushPinIcon size={20} />
          </span>
          {/* h4 visually, h2 semantically: the section sits directly under the
              screen's <h1>, else a screen reader sees an h1 to h4 jump. */}
          <TypographyAtom
            variant='h4'
            as='h2'
            id='pinned-manager-title'
            className={styles.heading}>
            {t('title')}
          </TypographyAtom>
        </div>
        <span className={styles.counter}>
          {usage != null &&
            (isUnlimitedLimit(usage.limits.max_pinned_records)
              ? t('counterUnlimited', { pinned: usage.pinned_records })
              : t('counter', {
                  pinned: usage.pinned_records,
                  max: usage.limits.max_pinned_records,
                }))}
        </span>
      </div>

      {/* One status line in a fixed place: the section description or, at the
          limit, what to do next. A limit note or offer card above the grid
          would push the tiles from under the finger when the last work is pinned. */}
      <div className={styles.note} role='status'>
        {quota.state === 'one_remaining' || quota.state === 'exhausted' ? (
          quota.state === 'exhausted' && quota.count > quota.limit ? (
            <span>
              {t('limitNoteOver', {
                max: quota.limit,
                over: quota.count - quota.limit + 1,
              })}
            </span>
          ) : (
            <QuotaNoticeMolecule feature='pinned' quota={quota} />
          )
        ) : (
          <span>{t('body')}</span>
        )}
      </div>

      {isLoading && (
        <ul className={styles.grid}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <li key={i}>
              <SkeletonAtom
                variant='rect'
                width='100%'
                className={styles.tileSkeleton}
              />
            </li>
          ))}
        </ul>
      )}

      {/* A load error is NOT an empty gallery: the empty state says „nie masz
          jeszcze prac", blaming the user for a system failure with no way out.
          Branch order as in HistorySectionOrganism. */}
      {/* Show the error ONLY when
          there is nothing to show: TanStack sets `status: 'error'` while KEEPING
          data, so testing `isError` alone wiped already loaded works when a
          next page or background refresh failed. */}
      {!isLoading && isError && records.length === 0 && (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      )}

      {!isLoading && !isError && records.length === 0 && (
        <EmptyStateAtom
          icon={<ImagesIcon size={28} weight='duotone' />}
          title={t('emptyTitle')}
          titleAs='h4'
          description={t('emptyBody')}
          action={
            <LinkButtonAtom
              href={ROUTES_FRONT.GALLERY_UPLOAD_ASSET}
              variant='outlined'
              size='md'>
              {t('emptyCta')}
            </LinkButtonAtom>
          }
        />
      )}

      {!isLoading && records.length > 0 && (
        <>
          <ul className={styles.grid}>
            {records.map(record => (
              <PinTile
                key={record.gallery_record_id}
                galleryRecordId={record.gallery_record_id}
                assetUrl={record.asset_url}
                isPinned={record.is_pinned}
                pinLabel={t('pin')}
                unpinLabel={t('unpin')}
                onActionError={handlePinError}
              />
            ))}
          </ul>
          {hasNextPage && (
            <ButtonAtom
              variant='outlined'
              size='md'
              loading={isFetchingNextPage}
              onClick={() => void fetchNextPage()}>
              {t('loadMore')}
            </ButtonAtom>
          )}
          {/* Order stands BELOW the grid: first the stylist picks what to pin, then
              the order a client sees. The list has its own source (all visible
              pins in profile order) because the grid above is paginated and
              sorted newest first. */}
          <PinnedOrderMolecule
            publicLimit={
              quota.state === 'unknown' || quota.state === 'unlimited'
                ? null
                : quota.limit
            }
          />
        </>
      )}
      <QuotaUpgradeDialogOrganism
        open={quotaUpgradeOpen}
        feature='pinned'
        currentPlan={currentPlan}
        onClose={() => setQuotaUpgradeOpen(false)}
      />
    </section>
  );
}
