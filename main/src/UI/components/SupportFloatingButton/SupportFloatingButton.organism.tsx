import { AppLinkAtom as Link } from '../AppLink/AppLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ChatCircleDotsIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import styles from './SupportFloatingButton.module.css';

const HIDDEN_PATHS: string[] = [ROUTES_FRONT.CONTACT, ROUTES_FRONT.HELP_CENTER];

export function SupportFloatingButtonOrganism() {
  const router = useRouter();
  const t = useTranslations('nav');

  if (HIDDEN_PATHS.includes(router.pathname)) {
    return null;
  }

  return (
    <Link
      href={ROUTES_FRONT.CONTACT}
      className={styles.button}
      data-support-fab=''
      aria-label={t('contact')}>
      <ChatCircleDotsIcon size={22} weight='fill' />
    </Link>
  );
}
