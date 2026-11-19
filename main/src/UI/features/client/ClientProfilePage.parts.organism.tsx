// UI/features/client/ClientProfilePage.parts.organism.tsx
// Screen intro and loading skeleton of the client's own profile.
// Connected stylists: ClientProfilePaired.parts.organism.tsx; contact card:
// ClientProfileContactCard.organism.tsx; account links:
// ClientProfileSettings.parts.organism.tsx.

import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { OwnPersonAvatarMolecule } from '../../shared/profile/OwnPersonAvatar.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import styles from './ClientProfilePage.module.css';

interface ClientProfileHeroProps {
  displayName: string;
  memberSinceLabel?: string;
}

export function ClientProfileHeroOrganism({
  displayName,
  memberSinceLabel,
}: ClientProfileHeroProps) {
  const { data: user } = useCurrentUserAccount();
  return (
    <AppHeroOrganism
      title={displayName}
      meta={
        memberSinceLabel ? (
          <span data-breakable=''>{memberSinceLabel}</span>
        ) : undefined
      }
      aside={
        <OwnPersonAvatarMolecule
          person={user ?? { name: displayName }}
          size='lg'
          decorative
        />
      }
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
