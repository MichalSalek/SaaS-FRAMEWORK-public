// announcements/AnnouncementContent.molecule.tsx
// Announcement body with markdown and raw https links. HTML stays text.
// Internal paths use AppLinkAtom so a blog post opens inside the app.

import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import { ExternalLinkAtom } from '../../components/ExternalLink/ExternalLink.atom';
import { parseAnnouncementLinks } from '@kernel/domain/admin/announcement-links';
import styles from './AnnouncementContent.module.css';

interface AnnouncementContentProps {
  message: string;
  className?: string;
  /** Fires for an in-app link. External links stay inside ExternalLinkAtom. */
  onInternalOpen?: () => void;
}

export function AnnouncementContentMolecule({
  message,
  className,
  onInternalOpen,
}: AnnouncementContentProps) {
  const parts = parseAnnouncementLinks(message);
  return (
    <span className={className ? `${styles.root} ${className}` : styles.root}>
      {parts.map((part, index) => {
        if (part.href === undefined) {
          return <span key={index}>{part.text}</span>;
        }
        if (part.href.startsWith('/')) {
          return (
            <AppLinkAtom
              key={index}
              href={part.href}
              className={styles.link}
              {...(onInternalOpen !== undefined
                ? { onClick: onInternalOpen }
                : {})}>
              {part.text}
            </AppLinkAtom>
          );
        }
        return (
          <ExternalLinkAtom
            key={index}
            href={part.href}
            className={styles.link}>
            {part.text}
          </ExternalLinkAtom>
        );
      })}
    </span>
  );
}
