// UI/features/support/SupportThreadListPage.tsx
// The help hub (route SUPPORT).
//
// Layout (owner): hero, the row „Utwórz zgłoszenie” (→ SUPPORT_NEW),
// directly under it „Twoje zgłoszenia” (→ SUPPORT_THREADS, with the thread
// count and the unread replies), then the help topics and the help centre.
// The list of requests has its own screen: at the bottom of this one nobody
// found it. Every row is the shared NavRow, the same one as in the drawer and
// in the account settings.
//
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { useTranslations } from 'next-intl';
import {
  UserCircleIcon,
  CreditCardIcon,
  ImagesIcon,
  QuestionIcon,
  PaperPlaneTiltIcon,
  BookOpenTextIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ThreadsEntryRowOrganism } from './SupportThreadListPage.interactive.organism';
import styles from './SupportThreadListPage.module.css';

type FaqShortcutLabelKey =
  | 'listFaqShortcutAccount'
  | 'listFaqShortcutSubscription'
  | 'listFaqShortcutGallery'
  | 'listFaqShortcutOther';

type FaqShortcutCountKey =
  | 'listFaqShortcutAccountCount'
  | 'listFaqShortcutSubscriptionCount'
  | 'listFaqShortcutGalleryCount'
  | 'listFaqShortcutOtherCount';

interface FaqShortcut {
  id: 'account' | 'subscription' | 'gallery' | 'other';
  Icon: PhosphorIcon;
  labelKey: FaqShortcutLabelKey;
  countKey: FaqShortcutCountKey;
  helpTab: 'general' | 'stylists' | 'clients' | 'technical';
}

/* ============================================================
 *  Help topics — four rows that open the help centre on the right tab.
 *
 *  DECISION: these rows are TOPICAL, the help centre tabs are AUDIENCE-based, so each
 *  helpTab points at the tab where that topic's questions actually live (checked against
 *  FAQ_DATA), not the similarly named one: account → general, subscription → stylists
 *  (only stylists pay; 'general' has no payment question), gallery → stylists,
 *  other → technical. HelpCenterPage.composition reads the ?tab= deep link.
 * ============================================================ */

const FAQ_SHORTCUTS: readonly FaqShortcut[] = [
  {
    id: 'account',
    Icon: UserCircleIcon,
    labelKey: 'listFaqShortcutAccount',
    countKey: 'listFaqShortcutAccountCount',
    helpTab: 'general',
  },
  {
    id: 'subscription',
    Icon: CreditCardIcon,
    labelKey: 'listFaqShortcutSubscription',
    countKey: 'listFaqShortcutSubscriptionCount',
    helpTab: 'stylists',
  },
  {
    id: 'gallery',
    Icon: ImagesIcon,
    labelKey: 'listFaqShortcutGallery',
    countKey: 'listFaqShortcutGalleryCount',
    helpTab: 'stylists',
  },
  {
    id: 'other',
    Icon: QuestionIcon,
    labelKey: 'listFaqShortcutOther',
    countKey: 'listFaqShortcutOtherCount',
    helpTab: 'technical',
  },
] as const;

/* ============================================================
 *  Inner page
 * ============================================================ */

function SupportThreadListPageInner() {
  const t = useTranslations('pages.support');
  useAppBarTitle(t('title'));

  return (
    <div className={styles.page}>
      <AppHeroOrganism title={t('listHeroTitle')} />

      <NavRowListMolecule ariaLabel={t('listHeroTitle')}>
        <NavRowMolecule
          href={ROUTES_FRONT.SUPPORT_NEW}
          icon={<PaperPlaneTiltIcon size={22} />}
          label={t('listPrimaryCtaTitle')}
          description={t('listPrimaryCtaSubtitle')}
          trailing='disc'
        />
        <ThreadsEntryRowOrganism />
      </NavRowListMolecule>

      <NavRowListMolecule label={t('listFaqTitle')}>
        {FAQ_SHORTCUTS.map(({ id, Icon, labelKey, countKey, helpTab }) => (
          <NavRowMolecule
            key={id}
            href={`${ROUTES_FRONT.HELP_CENTER}?tab=${helpTab}`}
            icon={<Icon size={22} />}
            label={t(labelKey)}
            description={t(countKey)}
            trailing='chevron'
          />
        ))}
        <NavRowMolecule
          href={ROUTES_FRONT.HELP_CENTER}
          icon={<BookOpenTextIcon size={22} />}
          label={t('listHelpCenterTitle')}
          description={t('listHelpCenterSubtitle')}
          trailing='chevron'
        />
      </NavRowListMolecule>
    </div>
  );
}

/* ============================================================
 *  Shell with AppLayout
 * ============================================================ */

export function SupportThreadListPageComposition() {
  const t = useTranslations('pages.support');
  return (
    <AppLayoutComposition title={t('title')}>
      <SupportThreadListPageInner />
    </AppLayoutComposition>
  );
}
