import { useState } from 'react';
import Image from 'next/image';
import { getSalonProfilePath } from '@kernel/domain/salon-profile/salon.urls';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import { ExternalLinkAtom } from '../../components/ExternalLink/ExternalLink.atom';
import { useTranslations } from 'next-intl';
import { stylistDisplayName } from '../shared/profile/stylist-display-name';
import { PlanBadgeAtom } from '../../components/PlanBadge/PlanBadge.atom';
import { narrowPricingPlan } from '@kernel/policies/pricing.policy';
import { BuildingIcon, LinkBreakIcon, MapPinIcon } from '@phosphor-icons/react';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { AppMenuAtom } from '../../primitives/AppMenu.atom';
import { CANCEL_REQUEST_HASH } from './_client-onboarding.helpers';
import {
  formatPublicAddress,
  publicAddressMapHref,
  readAddressStreet,
} from './_profile-address.helpers';
import styles from './StylistProfilePage.module.css';

type AccountData =
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE']['account'];

interface StylistProfileHeaderProps {
  account: AccountData;
  identityKind?: 'person' | 'salon';
  salonLink?: {
    account_id: string;
    name: string;
    role: 'owner' | 'stylist';
    salon_vanity_url?: string | null;
  } | null;
  isPaired: boolean;
  /** The request's state stood only under the gallery,
   *  so the profile looked the same before and after sending it. */
  isPendingRequest?: boolean;
  onUnpairRequest: () => void;
}

export function StylistProfileHeaderOrganism({
  account,
  identityKind = 'person',
  salonLink,
  isPaired,
  isPendingRequest = false,
  onUnpairRequest,
}: StylistProfileHeaderProps) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const t = useTranslations('stylist.actions');
  const tSalon = useTranslations('salon.profile');
  const tLabels = useTranslations('labels');
  const tCancel = useTranslations('stylist.cancelRequest');

  const displayName = stylistDisplayName(account, tLabels('stylistFallback'));
  const plan = narrowPricingPlan(account.effective_pricing_plan ?? 'FREE');
  const businessName = account.business_name;
  const city = account.address_city;
  const place = formatPublicAddress(city, readAddressStreet(account));
  const description = account.description?.trim() ?? '';
  // DECISION: only the ADDRESS stands under the name. Website and Instagram live in the
  // „Kontakt” section (StylistProfileContactMolecule) and must not return here, or the same
  // fact stands on the page twice (owner).
  // A stylist in a salon is named by the salon link; her free-text business
  // name next to it read as a second salon („Właścicielka salonu Studio Ani”
  // over „Studio Velvet Nails”).
  const showBusinessName =
    Boolean(businessName) && businessName !== displayName && !salonLink;

  return (
    // The brand colour tints the WHOLE page through brandScopeProps on the page
    // root (see the DECISION in shared/branding/brandScope.module.css); the
    // header has no cover band, so it carries no colour variables of its own.
    <section className={styles.profileHero}>
      {isPaired && (
        <div className={styles.profileMenuWrapper}>
          <AppMenuAtom>
            <AppMenuAtom.MoreTrigger label={t('moreMenuAriaLabel')} />
            <AppMenuAtom.Content side='bottom' align='end'>
              <AppMenuAtom.Item tone='danger' onClick={onUnpairRequest}>
                <LinkBreakIcon size={16} />
                <span>{t('unpairMenu')}</span>
              </AppMenuAtom.Item>
            </AppMenuAtom.Content>
          </AppMenuAtom>
        </div>
      )}

      {/* Header: avatar beside the name (no cover band) */}
      <div className={styles.profileBody}>
        <div className={styles.profileAvatar}>
          {identityKind === 'salon' ? (
            account.avatar_url && account.avatar_url !== failedLogo ? (
              <Image
                className={styles.salonLogo}
                src={account.avatar_url}
                alt={displayName}
                width={72}
                height={72}
                unoptimized
                onError={() => setFailedLogo(account.avatar_url)}
              />
            ) : (
              <BuildingIcon size={40} aria-label={displayName} />
            )
          ) : (
            <AvatarAtom
              src={account.avatar_url ?? undefined}
              fallbackSrc={account.avatar_fallback_url ?? undefined}
              name={displayName}
              size='lg'
            />
          )}
        </div>

        <div className={styles.profileMeta}>
          {/* Marcellus serif name — canonical heading font for exhibit hero */}
          <div className={styles.profileNameRow}>
            <h1 className={styles.profileName}>{displayName}</h1>
            <PlanBadgeAtom plan={plan} tone='premium' />
          </div>
          {salonLink && (
            <AppLinkAtom
              className={styles.salonLink}
              href={getSalonProfilePath(salonLink)}>
              {tSalon(
                salonLink.role === 'owner' ? 'ownerLink' : 'stylistLink',
                { salon: salonLink.name }
              )}
            </AppLinkAtom>
          )}
          {showBusinessName && (
            <p className={styles.profileBusinessName}>{businessName}</p>
          )}
          {isPendingRequest && (
            <p className={styles.profileBusinessName}>
              {t('requestPending')}.{' '}
              <a href={CANCEL_REQUEST_HASH} className={styles.headerLink}>
                {tCancel('trigger')}
              </a>
            </p>
          )}
        </div>

        {place && (
          <div className={styles.profileInlineMeta}>
            <ExternalLinkAtom
              href={publicAddressMapHref(place)}
              className={`${styles.profileMetaItem} ${styles.mapLink}`}
              aria-label={t('openMap', { address: place })}>
              <span className={styles.mapIcon}>
                <MapPinIcon size={14} weight='fill' aria-hidden='true' />
              </span>
              {place}
            </ExternalLinkAtom>
          </div>
        )}
      </div>
      {description !== '' && (
        <p className={styles.profileDescription}>{description}</p>
      )}
    </section>
  );
}
