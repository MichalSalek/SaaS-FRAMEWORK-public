// UI/features/admin/AdminColorsTraitsPage.composition.tsx
// Admin Colours & Traits: page frame, the two tabs and the page's one main
// action (add to the list the open tab shows).

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PaintBrushIcon, PlusIcon, TagIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import { ColorsTabOrganism } from './components/ColorsTab.organism';
import { TraitsTabOrganism } from './components/TraitsTab.organism';
import { useAdminColors } from './hooks/useAdminColors';
import { useAdminTraits } from './hooks/useAdminTraits';
import styles from './AdminColorsTraitsPage.module.css';

type TabKey = 'colors' | 'traits';

export function AdminColorsTraitsPageComposition() {
  const t = useTranslations('admin.colorsTraits');
  const [tab, setTab] = useState<TabKey>('colors');
  const [createOpen, setCreateOpen] = useState(false);
  // Both counts live on the tabs (the tab IS the door to the counted list).
  // Only one tab is mounted at a time, so the page reads the shared queries.
  const { colors } = useAdminColors();
  const { traits } = useAdminTraits();

  const tabProps = {
    createOpen,
    onCreateOpen: () => setCreateOpen(true),
    onCreateClose: () => setCreateOpen(false),
  };

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('heroEyebrow')}
      title={t('pageTitle')}
      subtitle={t('heroSubtitle')}
      actions={
        <ButtonAtom
          size='sm'
          variant='primary'
          icon={<PlusIcon size={14} weight='bold' />}
          onClick={() => setCreateOpen(true)}>
          {tab === 'colors' ? t('addColor') : t('addTrait')}
        </ButtonAtom>
      }>
      <div className={styles.page}>
        <SegmentedControlMolecule
          className={styles.tabs}
          semantics='tabs'
          size='sm'
          shape='pill'
          ariaLabel={t('pageTitle')}
          value={tab}
          onChange={setTab}
          options={[
            {
              value: 'colors',
              id: 'tab-colors',
              controls: 'panel-colors',
              label: t('tabColors'),
              ...(colors !== null ? { count: colors.length } : {}),
              icon: (
                <PaintBrushIcon
                  size={14}
                  weight={tab === 'colors' ? 'fill' : 'regular'}
                />
              ),
            },
            {
              value: 'traits',
              id: 'tab-traits',
              controls: 'panel-traits',
              label: t('tabTraits'),
              ...(traits !== null ? { count: traits.length } : {}),
              icon: (
                <TagIcon
                  size={14}
                  weight={tab === 'traits' ? 'fill' : 'regular'}
                />
              ),
            },
          ]}
        />

        {tab === 'colors' ? (
          <div
            role='tabpanel'
            id='panel-colors'
            aria-labelledby='tab-colors'
            className={styles.panel}>
            <ColorsTabOrganism {...tabProps} />
          </div>
        ) : (
          <div
            role='tabpanel'
            id='panel-traits'
            aria-labelledby='tab-traits'
            className={styles.panel}>
            <TraitsTabOrganism {...tabProps} />
          </div>
        )}
      </div>
    </AdminPageLayoutComposition>
  );
}
