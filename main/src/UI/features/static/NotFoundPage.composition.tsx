import { useTranslations } from 'next-intl';
import {
  PaintBrushIcon,
  HeartIcon,
  TagIcon,
  LifebuoyIcon,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { NavCardOrganism } from '../../components/NavCard/NavCard.organism';
import { SystemNoticeOrganism } from '../../components/SystemNotice/SystemNotice.organism';
import notice from '../../components/SystemNotice/SystemNotice.module.css';
import styles from './NotFoundPage.module.css';

/**
 * 404 Not Found page.
 *
 * Layout:
 *   1. The shared system intro (SystemNoticeOrganism): the title, one
 *      sentence of what happened, the way home (filled) and contact (outlined).
 *   2. Shortcuts: 4 quick-link cards, in the same column width as the intro,
 *      so the person can recover even with no idea what URL they wanted.
 *
 * Tone: humble + helpful. NOT punitive, NOT generic "Oops".
 */

interface ShortcutCard {
  href: string;
  Icon: PhosphorIcon;
  titleKey:
    | 'cards.forStylists.title'
    | 'cards.forClients.title'
    | 'cards.pricing.title'
    | 'cards.helpCenter.title';
  descKey:
    | 'cards.forStylists.desc'
    | 'cards.forClients.desc'
    | 'cards.pricing.desc'
    | 'cards.helpCenter.desc';
}

const SHORTCUT_CARDS: readonly ShortcutCard[] = [
  {
    href: ROUTES_FRONT.FOR_STYLISTS,
    Icon: PaintBrushIcon,
    titleKey: 'cards.forStylists.title',
    descKey: 'cards.forStylists.desc',
  },
  {
    href: ROUTES_FRONT.FOR_CLIENTS,
    Icon: HeartIcon,
    titleKey: 'cards.forClients.title',
    descKey: 'cards.forClients.desc',
  },
  {
    href: ROUTES_FRONT.PRICING,
    Icon: TagIcon,
    titleKey: 'cards.pricing.title',
    descKey: 'cards.pricing.desc',
  },
  {
    href: ROUTES_FRONT.HELP_CENTER,
    Icon: LifebuoyIcon,
    titleKey: 'cards.helpCenter.title',
    descKey: 'cards.helpCenter.desc',
  },
] as const;

export function NotFoundPageComposition() {
  const t = useTranslations('static.notFound');

  return (
    <PublicLayoutComposition>
      <div className={notice.page}>
        <SystemNoticeOrganism
          titleId='not-found-heading'
          title={t('heading')}
          body={t('body')}
          actions={
            <>
              <LinkButtonAtom
                href={ROUTES_FRONT.HOME}
                variant='primary'
                size='lg'>
                {t('primaryBtn')}
              </LinkButtonAtom>
              <LinkButtonAtom
                href={ROUTES_FRONT.CONTACT}
                variant='outlined'
                size='lg'>
                {t('secondaryBtn')}
              </LinkButtonAtom>
            </>
          }
        />

        {/* ─── SHORTCUTS — quick-link cards ─── */}
        <section
          className={styles.shortcuts}
          aria-labelledby='not-found-shortcuts'>
          <h2 id='not-found-shortcuts' className={styles.shortcutsLabel}>
            {t('shortcutsLabel')}
          </h2>
          <ul className={styles.cardGrid}>
            {SHORTCUT_CARDS.map(({ href, Icon, titleKey, descKey }) => (
              <li key={href}>
                <NavCardOrganism
                  href={href}
                  linkType='internal'
                  icon={<Icon size={20} weight='duotone' />}
                  title={t(titleKey)}
                  titleAs='span'
                  body={t(descKey)}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PublicLayoutComposition>
  );
}
