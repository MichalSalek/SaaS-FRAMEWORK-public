import { useTranslations } from 'next-intl';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { AdminRuntimeConfigEditorOrganism } from './AdminRuntimeConfigEditor.organism';

export function AdminConfigPageComposition() {
  const t = useTranslations('admin.config');
  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}>
      <AdminRuntimeConfigEditorOrganism scope='settings' />
    </AdminPageLayoutComposition>
  );
}
