import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { ChipAtom } from '../../components/Chip/Chip.atom';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { PlanBadgeAtom } from '../../components/PlanBadge/PlanBadge.atom';
import { UsersThreeIcon } from '@phosphor-icons/react';
import {
  HeroCountPillAtom,
  HeroCountPillRowAtom,
} from '../../components/HeroCountPill/HeroCountPill.atom';
import { LABEL_FAMILY_ENTRIES } from './uiLibrary.registry';
import {
  LibraryEntryComposition,
  LibrarySectionComposition,
  DemoRowComposition,
} from './UiLibraryEntry.composition';
import styles from './UiLibraryPage.module.css';

/**
 * Sekcja „Rodzina etykiet: kiedy które" — taksonomia anty-reinwencji (S28).
 * Jeden render KAŻDEJ etykiety obok zdania „kiedy używać", żeby następna sesja
 * NIE budowała szóstego wariantu badge'a, gdy istnieje właściwy.
 */
export function UiLibrarySectionLabelFamilyOrganism() {
  return (
    <LibrarySectionComposition
      id='label-family'
      title='Rodzina etykiet: kiedy które'>
      <LibraryEntryComposition meta={LABEL_FAMILY_ENTRIES.labelEyebrowChip}>
        <DemoRowComposition label='KICKER nad nagłówkiem'>
          <EyebrowAtom variant='chip'>Cennik</EyebrowAtom>
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={LABEL_FAMILY_ENTRIES.labelChip}>
        <DemoRowComposition label='TAG / FILTR (usuwalny lub klikalny)'>
          <ChipAtom label='French' onDelete={() => undefined} />
          {/* Klikalny chip (onClick) = role=button + tab-order + Enter/Space (S33). */}
          <ChipAtom label='Filtr' size='sm' onClick={() => undefined} />
          <ChipAtom label='Matowy' size='sm' />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={LABEL_FAMILY_ENTRIES.labelStatusPill}>
        <DemoRowComposition label='STAN obiektu'>
          <div className={styles.labelRow}>
            <StatusPillAtom
              color='var(--color-success)'
              label='Otwarte'
              pulse
            />
            <StatusPillAtom
              color='var(--color-text-secondary)'
              label='Rozwiązane'
            />
            <StatusPillAtom
              color='var(--color-warning)'
              label='OCZEKUJE'
              uppercase
            />
          </div>
        </DemoRowComposition>
        <DemoRowComposition label='emphasis="solid" — jeden poziom, który ma wyjść ponad tint (waga krytyczna)'>
          <div className={styles.labelRow}>
            <StatusPillAtom color='var(--color-error)' label='HIGH' uppercase />
            <StatusPillAtom
              color='var(--color-error)'
              label='CRITICAL'
              uppercase
              emphasis='solid'
              showDot={false}
            />
          </div>
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={LABEL_FAMILY_ENTRIES.heroCountPill}>
        <DemoRowComposition label='LICZNIK w nagłówku ekranu'>
          <HeroCountPillRowAtom>
            <HeroCountPillAtom
              icon={<UsersThreeIcon size={13} weight='fill' />}>
              15 użytkowniczek
            </HeroCountPillAtom>
            <HeroCountPillAtom tone='emphasized'>
              3 zaznaczone
            </HeroCountPillAtom>
            <HeroCountPillAtom tone='alert' pulse>
              2 czekają
            </HeroCountPillAtom>
          </HeroCountPillRowAtom>
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={LABEL_FAMILY_ENTRIES.labelPlanBadge}>
        <DemoRowComposition label='PLAN (FREE → null, brak badge)'>
          <div className={styles.labelRow}>
            <PlanBadgeAtom plan={PricingPlanValue.PRO} />
            <PlanBadgeAtom plan={PricingPlanValue.PRO_PLUS} />
            <PlanBadgeAtom plan={PricingPlanValue.STUDIO} />
            <PlanBadgeAtom plan={PricingPlanValue.SCALE} />
          </div>
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={LABEL_FAMILY_ENTRIES.labelSaveBadge} />
      <LibraryEntryComposition meta={LABEL_FAMILY_ENTRIES.labelColChip} />
    </LibrarySectionComposition>
  );
}
