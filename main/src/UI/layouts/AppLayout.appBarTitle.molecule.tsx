// UI/layouts/AppLayout.appBarTitle.molecule.tsx
// Centered app-bar title (optional avatar + text). Split from AppLayout to keep
// the layout under its line cap.

import { AvatarAtom } from '../components/Avatar/Avatar.atom';
import styles from './AppLayout.module.css';

export function AppBarTitleMolecule({
  avatar,
  title,
  asHeading = false,
}: {
  avatar: string | null;
  title: string;
  /** The screen has no intro card: this title is its `<h1>`. */
  asHeading?: boolean;
}) {
  const TitleTag = asHeading ? 'h1' : 'span';
  return (
    <span className={styles.appBarTitle}>
      {avatar !== null && <AvatarAtom src={avatar} name='' size='sm' />}
      {/* Own element: text-overflow does not apply to bare text in a flex
          container, so a long title (e.g. a photo author's name) ran under
          "Wróć" instead of ending in an ellipsis (S122). */}
      <TitleTag className={styles.appBarTitleText}>{title}</TitleTag>
    </span>
  );
}
