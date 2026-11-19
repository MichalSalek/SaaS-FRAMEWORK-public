import { personAvatarSources } from '@kernel/domain/user/avatar.policy';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';

/** The same personal identity follows the user across active roles and surfaces. */
export function OwnPersonAvatarMolecule({
  person,
  size,
  decorative = false,
}: {
  person: {
    name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
    image?: string | null;
  };
  size: 'sm' | 'md' | 'lg' | 'xl';
  decorative?: boolean;
}) {
  const sources = personAvatarSources(person);
  const name = person.name?.trim() || person.email?.split('@')[0] || 'U';
  return (
    <AvatarAtom
      src={sources[0]}
      fallbackSrc={sources[1]}
      name={name}
      size={size}
      decorative={decorative}
    />
  );
}
