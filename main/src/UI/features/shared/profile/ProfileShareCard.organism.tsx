// UI/features/shared/profile/ProfileShareCard.organism.tsx
// Profile Hub: surfaces the stylist's own public profile link so she can share
// it (IG bio, clients) and close the organic discovery / viral loop.
// Shared (features/shared/**): mounted on the stylist dashboard and the first-photo card. The
// profile screens (/app/profile) open with ProfileLinkCard instead; both use the same copy and
// share actions (useProfileLinkActions). Namespace `components.profileShare` is core.
// GROWTH-CRITICAL: the app had no in-product way for
// a stylist to share her own /stylist/{vanity} profile.
// Stack: TQ v5 (useCurrentUserAccount) + CSS Modules + Phosphor Icons.

import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import {
  CardMolecule,
  CardContentAtom,
} from '../../../components/Card/Card.molecule';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useProfileLinkActions } from './useProfileLinkActions';
import { ProfileUrlCopyRow } from './ProfileLinkCard.organism';
import styles from './ProfileShareCard.module.css';

/* --- Empty state: vanity not set yet ---
 * The CTA leads to /app/profile, where the address field lives (before, it sent
 * to the bare account screen, where she still had to find the right section). */

function ProfileShareEmpty({
  ctaVariant,
}: {
  ctaVariant: 'primary' | 'outlined';
}) {
  const t = useTranslations('components.profileShare');
  const lang = useCurrentLang();

  return (
    <CardMolecule variant='outlined' className={styles.card}>
      <CardContentAtom className={styles.content}>
        <TypographyAtom variant='h4' as='h2' className={styles.title}>
          {t('emptyTitle')}
        </TypographyAtom>
        <TypographyAtom variant='body2' className={styles.body} lang={lang}>
          {t('emptyBody')}
        </TypographyAtom>
        <div className={styles.actions}>
          <LinkButtonAtom
            href={ROUTES_FRONT.STYLIST_PROFILE_MANAGE}
            variant={ctaVariant}
            size='sm'
            direction='forward'
            className={styles.action}>
            {t('emptyCta')}
          </LinkButtonAtom>
        </div>
      </CardContentAtom>
    </CardMolecule>
  );
}

/* --- Active state: vanity present --- */

/* DECISION: the full address is the copy button, with a trailing success mark (ProfileUrlCopyRow).
 * No success toast on top (one fact, one place); a failed copy still toasts. (owner) */
function ProfileShareActive({
  vanity,
  ctaVariant,
}: {
  vanity: string;
  ctaVariant: 'primary' | 'outlined';
}) {
  const t = useTranslations('components.profileShare');
  const lang = useCurrentLang();
  const path = buildRoute(ROUTES_FRONT.STYLIST_PROFILE, { identifier: vanity });
  const link = useProfileLinkActions(path, 'stylist');

  return (
    <CardMolecule variant='outlined' className={styles.card}>
      <CardContentAtom className={styles.content}>
        <TypographyAtom variant='h4' as='h2' className={styles.title}>
          {t('title')}
        </TypographyAtom>
        <TypographyAtom variant='body2' className={styles.body} lang={lang}>
          {t('body')}
        </TypographyAtom>
        <ProfileUrlCopyRow
          displayUrl={link.displayUrl}
          copied={link.copied}
          onCopy={() => void link.copy()}
        />
        <div className={styles.actions}>
          <ButtonAtom
            variant={ctaVariant}
            size='sm'
            className={styles.action}
            onClick={() => void link.share()}>
            {t('shareAction')}
          </ButtonAtom>
          <LinkButtonAtom
            href={path}
            variant='outlined'
            size='sm'
            className={styles.action}>
            {t('previewAction')}
          </LinkButtonAtom>
        </div>
      </CardContentAtom>
    </CardMolecule>
  );
}

/* --- Public component --- */

export function ProfileShareCardOrganism({
  ctaVariant = 'primary',
}: {
  /** Dashboard passes outlined when another filled CTA already owns the screen. */
  ctaVariant?: 'primary' | 'outlined';
}) {
  const { data: currentUser } = useCurrentUserAccount();
  const vanity = currentUser?.stylist_account?.vanity_url ?? null;

  if (!vanity) {
    return <ProfileShareEmpty ctaVariant={ctaVariant} />;
  }
  return <ProfileShareActive vanity={vanity} ctaVariant={ctaVariant} />;
}
