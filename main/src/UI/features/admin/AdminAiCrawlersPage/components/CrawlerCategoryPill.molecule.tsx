// UI/features/admin/AdminAiCrawlersPage/components/CrawlerCategoryPill.molecule.tsx
// A bot category as the shared status pill: translated label, one role colour
// per category (the colour encodes data; see `crawlerCategoryColor`).

import { useTranslations } from 'next-intl';
import { StatusPillAtom } from '../../../../components/StatusPill/StatusPill.atom';
import {
  crawlerCategoryColor,
  crawlerCategoryLabelKey,
} from '../crawler-category-label';

export function CrawlerCategoryPillMolecule({
  category,
}: {
  category: string | null;
}) {
  const t = useTranslations('admin.aiCrawlers');
  const key = category === null ? null : crawlerCategoryLabelKey(category);
  return (
    <StatusPillAtom
      color={crawlerCategoryColor(category)}
      label={key ? t(key) : (category ?? t('category.unknown'))}
      showDot={false}
    />
  );
}
