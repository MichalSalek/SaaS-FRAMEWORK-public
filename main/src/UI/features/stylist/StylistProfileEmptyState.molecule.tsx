import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { HouseIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import styles from './StylistProfilePage.module.css';

/* ─── Empty / Error State (wydzielone z composition, max-lines) ─── */

interface StylistProfileEmptyStateProps {
  title: string;
  description: string;
  /** Extra action rendered before the „back home" link (e.g. retry). */
  action?: ReactNode;
}

export function StylistProfileEmptyStateMolecule({
  title,
  description,
  action,
}: StylistProfileEmptyStateProps) {
  const tProfile = useTranslations('stylist.profile');
  return (
    <div className={styles.emptyState}>
      {/* h1 — on the not-found/error route this is the page's only/main heading. */}
      <TypographyAtom variant='h1' align='center'>
        {title}
      </TypographyAtom>
      <TypographyAtom
        variant='body2'
        align='center'
        className={styles.emptyDescription}>
        {description}
      </TypographyAtom>
      {action}
      <LinkButtonAtom
        href={ROUTES_FRONT.HOME}
        variant='primary'
        size='md'
        icon={<HouseIcon size={16} />}
        className={styles.emptyLink}>
        {tProfile('backHome')}
      </LinkButtonAtom>
    </div>
  );
}
