import type { GetStaticPropsContext, InferGetStaticPropsType } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';
import { MaintenancePageComposition } from '../UI/features/maintenance/MaintenancePage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';

/**
 * Maintenance page — STANDALONE (no layout wrapper).
 *
 * Intentionally rendered WITHOUT PublicLayout — no header, no footer.
 * The full viewport is owned by MaintenancePage itself.
 * Activate by redirecting all routes here (e.g. via middleware or env flag).
 */
export default function Maintenance(
  props: InferGetStaticPropsType<typeof getStaticProps>
) {
  return (
    <>
      <PublicSeoHeadComposition
        title={props.seoTitle}
        description={props.seoDescription}
        path='/maintenance'
        noindex
      />
      <MaintenancePageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale ?? 'pl', [
    'static.maintenance',
    'seo',
  ]);
  return {
    props: {
      messages,
      seoTitle: resolveMsgKey(messages, 'seo.maintenance.title'),
      seoDescription: resolveMsgKey(messages, 'seo.maintenance.description'),
    },
  };
}
