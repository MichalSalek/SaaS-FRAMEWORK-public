// UI/features/client/ClientProfilePage.parts.organism.tsx
// Screen intro and loading skeleton of the client's own profile.
// Connected stylists: ClientProfilePaired.parts.organism.tsx; contact card:
// ClientProfileContactCard.organism.tsx; account links:
// ClientProfileSettings.parts.organism.tsx.

import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import styles from './ClientProfilePage.module.css';

interface ClientProfileHeroProps {
  displayName: string;
  memberSinceLabel?: string;
}

/* DECISION (nie usuwaj tego komentarza) — S126: the camera badge on the avatar
 * is gone. It was a permanently disabled button („wkrótce”): a client has no
 * photo upload (`ACCOUNT_SET_AVATAR` writes `stylist_account.avatar_url` only),
 * so the badge promised an action that does not exist. Bring it back together
 * with a real upload, never as a disabled placeholder. */
export function ClientProfileHeroOrganism({
  displayName,
  memberSinceLabel,
}: ClientProfileHeroProps) {
  return (
    <AppHeroOrganism
      title={displayName}
      meta={memberSinceLabel ? <span>{memberSinceLabel}</span> : undefined}
      aside={<AvatarAtom name={displayName} size='lg' decorative />}
    />
  );
}

/** Same boxes as the loaded screen: intro, two stylist rows, contact card. */
export function ClientProfileSkeletonOrganism() {
  return (
    <div className={styles.page} aria-hidden='true'>
      <SkeletonAtom variant='rect' width='100%' height={124} />
      <div className={styles.section}>
        <SkeletonAtom variant='text' width='40%' height={22} />
        <SkeletonAtom variant='rect' width='100%' height={136} />
      </div>
      <SkeletonAtom variant='rect' width='100%' height={232} />
      <SkeletonAtom variant='rect' width='100%' height={174} />
    </div>
  );
}
