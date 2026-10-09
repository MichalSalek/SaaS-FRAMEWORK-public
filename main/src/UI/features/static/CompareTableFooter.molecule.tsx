import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { usePublicFeatureFlag } from '../../../application/feature-flags/client-feature-flags';
import { buildRoute } from '../../../application/routing/buildRoute';
import { COMPARE_BLOG_POST_SLUG } from './ComparePage.helpers';
import styles from './ComparePage.module.css';

/**
 * Under the comparison table: the one-line summary and, when the blog is on,
 * a link to the comparison post written for the page's language.
 */
export function CompareTableFooterMolecule() {
  const t = useTranslations('static.compare');
  const { locale } = useRouter();
  const blogEnabled = usePublicFeatureFlag(FEATURE_FLAG_KEYS.BLOG_ENABLED);

  const slug = COMPARE_BLOG_POST_SLUG[getLocaleOrDefault(locale)];
  return (
    <>
      <p className={styles.tableSummary}>{t('table.summary')}</p>
      {blogEnabled && (
        <p className={styles.tableBlogLink}>
          {t('table.blogLinkLead')}{' '}
          <AppParagraphLinkAtom
            href={buildRoute(ROUTES_FRONT.BLOG_POST, { slug })}>
            {t('table.blogLinkLabel')}
          </AppParagraphLinkAtom>
        </p>
      )}
    </>
  );
}
