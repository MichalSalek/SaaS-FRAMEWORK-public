import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { usePublicFeatureFlag } from '../../../application/feature-flags/client-feature-flags';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { SectionComposition } from '../../components/Section/Section.composition';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import styles from './SiteMapPage.module.css';

export function SiteMapPageComposition() {
  const t = useTranslations('static.siteMap');
  const nav = useTranslations('nav');
  const menu = useTranslations('menu');
  const blogEnabled = usePublicFeatureFlag(FEATURE_FLAG_KEYS.BLOG_ENABLED);
  const groups = [
    {
      title: t('product'),
      links: [
        { href: ROUTES_FRONT.HOME, label: t('home') },
        { href: ROUTES_FRONT.FOR_STYLISTS, label: nav('forStylists') },
        { href: ROUTES_FRONT.FOR_CLIENTS, label: nav('forClients') },
        { href: ROUTES_FRONT.FOR_STUDIOS, label: nav('forStudios') },
        { href: ROUTES_FRONT.PRICING, label: nav('pricing') },
        { href: ROUTES_FRONT.COMPARE, label: nav('compare') },
        { href: ROUTES_FRONT.GET_APP, label: nav('getApp') },
        ...(blogEnabled
          ? [{ href: ROUTES_FRONT.BLOG, label: nav('blog') }]
          : []),
      ],
    },
    {
      title: t('support'),
      links: [
        { href: ROUTES_FRONT.ABOUT, label: nav('about') },
        { href: ROUTES_FRONT.CONTACT, label: nav('contact') },
        { href: ROUTES_FRONT.HELP_CENTER, label: menu('helpCenter') },
        { href: ROUTES_FRONT.STATUS, label: nav('status') },
        { href: ROUTES_FRONT.WELCOME, label: nav('welcome') },
      ],
    },
    {
      title: t('legal'),
      links: [
        { href: ROUTES_FRONT.TERMS, label: menu('terms') },
        { href: ROUTES_FRONT.PRIVACY, label: menu('privacy') },
        { href: ROUTES_FRONT.COOKIES, label: nav('cookies') },
        {
          href: ROUTES_FRONT.CONTENT_MODERATION,
          label: nav('contentModeration'),
        },
      ],
    },
  ];
  return (
    <PublicLayoutComposition>
      <SectionComposition>
        <header className={styles.header}>
          <h1>{t('title')}</h1>
          <p>{t('description')}</p>
        </header>
        <div className={styles.groups}>
          {groups.map(group => (
            <section key={group.title} className={styles.group}>
              <h2>{group.title}</h2>
              <ul>
                {group.links.map(link => (
                  <li key={link.href}>
                    <AppParagraphLinkAtom href={link.href} prefetch={false}>
                      {link.label}
                    </AppParagraphLinkAtom>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SectionComposition>
    </PublicLayoutComposition>
  );
}
