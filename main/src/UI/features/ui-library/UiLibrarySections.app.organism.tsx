import { useState } from 'react';
import {
  HouseIcon,
  ImageSquareIcon,
  PlusIcon,
  HeartIcon,
  GearIcon,
} from '@phosphor-icons/react';
import type { ColorDTO, TraitDTO } from '@kernel/models/db_models.manual.dto';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { TIME } from '@kernel/application/constants.config';
import { AppBarOrganism } from '../../components/AppBar/AppBar.organism';
import { APP_BAR_DEMO_LINKS } from './uiLibrary.demoData';
import { BottomTabBarOrganism } from '../../components/BottomTabBar/BottomTabBar.organism';
import { HeaderUserMenuOrganism } from '../../components/HeaderUserMenu/HeaderUserMenu.organism';
import { ButtonAtom } from '../../components/Button/Button.atom';
import {
  GalleryPhotoCardOrganism,
  type GalleryRecordView,
} from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import { GalleryQuickFiltersOrganism } from '../../components/GalleryQuickFilters/GalleryQuickFilters.organism';
import { GalleryStrengthOrganism } from '../../components/GalleryStrength/GalleryStrength.organism';
import { GalleryLayoutToggleAtom } from '../../components/GalleryLayoutToggle/GalleryLayoutToggle.atom';
import type { GalleryLayout } from '../../components/GalleryLayoutToggle/GalleryLayoutToggle.atom';
import { TrialCountdownBannerMolecule } from '../../components/TrialCountdownBanner/TrialCountdownBanner.molecule';
import { SupportFloatingButtonOrganism } from '../../components/SupportFloatingButton/SupportFloatingButton.organism';
import {
  ColorSwatchMolecule,
  ColorSwatchGridOrganism,
} from '../../components/ColorSwatch/ColorSwatch.molecule';
import { ImagePlaceholderAtom } from '../../components/ImagePlaceholder/ImagePlaceholder.atom';
import { ExternalLinkAtom } from '../../components/ExternalLink/ExternalLink.atom';
import { ShareButtonAtom } from '../../components/ShareButton/ShareButton.atom';
import { APP_ENTRIES, UTILITY_ENTRIES } from './uiLibrary.registry';
import {
  LibraryEntryComposition,
  LibrarySectionComposition,
  DemoRowComposition,
} from './UiLibraryEntry.composition';
import styles from './UiLibraryPage.module.css';

/* ─── Demo data (przykładowe, kształt 1:1 z DTO API) ─── */

const DEMO_COLORS: ColorDTO[] = [
  { id: 'c-nude', name: 'Nude', hex_code: '#e8c9b5' },
  { id: 'c-red', name: 'Czerwony', hex_code: '#a32638' },
  { id: 'c-violet', name: 'Fiolet', hex_code: '#6b4d8f' },
];

const DEMO_TRAITS: TraitDTO[] = [
  {
    id: 't-french',
    name: 'French',
    category: 'style',
    icon_url: null,
    is_featured: false,
  },
  {
    id: 't-mat',
    name: 'Matowy',
    category: 'finish',
    icon_url: null,
    is_featured: false,
  },
];

const DEMO_RECORD: GalleryRecordView = {
  gallery_record_id: 'rec-demo',
  asset_url: '',
  nail_length: NAIL_LENGTHS.MEDIUM,
  is_pinned: true,
  colors: DEMO_COLORS,
  traits: DEMO_TRAITS,
  created_at: '2026-06-01T10:00:00.000Z',
  like_count: 7,
};

const DEMO_LENGTHS = [
  { id: NAIL_LENGTHS.SHORT, label: 'Krótkie' },
  { id: NAIL_LENGTHS.MEDIUM, label: 'Średnie' },
  { id: NAIL_LENGTHS.LONG, label: 'Długie' },
] as const;

/* ─── Demo z lokalnym stanem ─── */

/** GalleryQuickFilters jest controlled — selected/onToggle props trzymają ID. */
function QuickFiltersDemo() {
  const [colors, setColors] = useState<string[]>(['c-red']);
  const [traits, setTraits] = useState<string[]>([]);
  const [length, setLength] = useState<string | null>('MEDIUM');

  const toggle = (id: string, set: typeof setColors) =>
    set(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

  return (
    <GalleryQuickFiltersOrganism
      availableColors={DEMO_COLORS}
      availableTraits={DEMO_TRAITS}
      availableNailLengths={DEMO_LENGTHS}
      selectedColors={colors}
      selectedTraits={traits}
      selectedLength={length}
      onToggleColor={id => toggle(id, setColors)}
      onToggleTrait={id => toggle(id, setTraits)}
      onToggleLength={id => setLength(prev => (prev === id ? null : id))}
    />
  );
}

/** GalleryLayoutToggle jest controlled (layout + onToggle). */
function LayoutToggleDemo() {
  const [layout, setLayout] = useState<GalleryLayout>('tiles');
  return (
    <GalleryLayoutToggleAtom
      layout={layout}
      onToggle={() =>
        setLayout(prev => (prev === 'tiles' ? 'full-width' : 'tiles'))
      }
    />
  );
}

/** ColorSwatch interaktywny — selected + onClick toggle. */
function ColorSwatchDemo() {
  const [selected, setSelected] = useState<string>('c-red');
  return (
    <ColorSwatchGridOrganism>
      {DEMO_COLORS.map(c => (
        <ColorSwatchMolecule
          key={c.id}
          name={c.name}
          hex={c.hex_code}
          selected={selected === c.id}
          onClick={() => setSelected(c.id)}
        />
      ))}
    </ColorSwatchGridOrganism>
  );
}

/* ─── Sekcja: Organizmy aplikacji ─── */

export function UiLibrarySectionAppOrganism() {
  // Trial kończący się za 3 dni — wymusza tier `urgent` (loss aversion).
  const trialEndsAt = new Date(Date.now() + 3 * TIME.MS_PER_DAY).toISOString();

  return (
    <LibrarySectionComposition
      id='app-organisms'
      title='Organizmy aplikacji (S28)'>
      <LibraryEntryComposition
        meta={APP_ENTRIES.appBar}
        note='Górna belka rozciąga się na 100% szerokości, ramka udaje krawędzie ekranu. Hamburger z menu kafli pojawia się poniżej 1280px okna.'>
        <div className={styles.appBarScope}>
          <AppBarOrganism
            logo={<strong>Nailfolio</strong>}
            activeHref='#app-organisms'
            links={APP_BAR_DEMO_LINKS}
            actions={
              <ButtonAtom variant='primary' size='sm'>
                Załóż konto
              </ButtonAtom>
            }
          />
        </div>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={APP_ENTRIES.bottomTabBar}>
        <div className={styles.phoneFrame}>
          <div className={styles.phoneFrameBody}>Ekran aplikacji</div>
          <BottomTabBarOrganism
            className={styles.phoneFrameTabBar}
            tabs={[
              {
                label: 'Start',
                icon: <HouseIcon size={22} />,
                active: true,
              },
              { label: 'Galeria', icon: <ImageSquareIcon size={22} /> },
              {
                label: 'Dodaj',
                icon: <PlusIcon size={24} />,
                elevated: true,
              },
              { label: 'Ulubione', icon: <HeartIcon size={22} /> },
              { label: 'Konto', icon: <GearIcon size={22} /> },
            ]}
          />
        </div>
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={APP_ENTRIES.headerUserMenu}
        note='Auth-aware — w bibliotece (wizyta niezalogowana) renderuje domyślne CTA „Zaloguj się" / na desktopie bez app-access „Otwórz na telefonie". Avatar + dropdown widać dopiero po zalogowaniu.'>
        <DemoRowComposition label='stan: niezalogowany / desktop get-app (zależnie od kontekstu)'>
          <HeaderUserMenuOrganism />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={APP_ENTRIES.galleryPhotoCard}
        note='Tu z honest placeholderem (asset_url puste) + wszystkimi overlayami: serce, share, pin-badge, like-count ≥3.'>
        <div className={styles.galleryGrid}>
          <GalleryPhotoCardOrganism
            record={DEMO_RECORD}
            showHeart
            isFavorited
            showShare
            showPinBadge
            likeCount={7}
          />
          <GalleryPhotoCardOrganism
            record={{
              ...DEMO_RECORD,
              gallery_record_id: 'rec-2',
              is_pinned: false,
            }}
          />
        </div>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={APP_ENTRIES.galleryQuickFilters}>
        <QuickFiltersDemo />
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={APP_ENTRIES.galleryStrength}
        note='N6 Endowed Progress — wynik startuje od 25%, nigdy 0; checklista pokazuje braki z punktacją.'>
        <div className={styles.appCardCol}>
          <GalleryStrengthOrganism
            photoCount={3}
            hasProfileBio
            hasProfilePhoto={false}
            hasSpecialization={false}
            pairedClientCount={0}
          />
        </div>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={APP_ENTRIES.galleryLayoutToggle}>
        <DemoRowComposition label='kafelki ↔ pełna szerokość (interaktywny)'>
          <LayoutToggleDemo />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={APP_ENTRIES.trialCountdownBanner}
        note='Demo: trial kończy się za 3 dni → tier „urgent". Banner znika po dismiss na czas sesji (sessionStorage).'>
        <TrialCountdownBannerMolecule trialEndsAt={trialEndsAt} />
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={APP_ENTRIES.supportFloatingButton}
        note='position: fixed — uwięziony w ramce przez transform (containing block). Na stronie dokleja się do rogu viewportu i ukrywa na /contact i /help.'>
        <div className={styles.floatingScope}>
          <SupportFloatingButtonOrganism />
        </div>
      </LibraryEntryComposition>

      {/* Organizmy bez żywego renderu (overlaye/portale/persisted-state) —
          udokumentowane przez noRenderReason, podgląd na żywych ekranach /app. */}
      <LibraryEntryComposition meta={APP_ENTRIES.appDrawer} />
      <LibraryEntryComposition meta={APP_ENTRIES.cookieBanner} />
      <LibraryEntryComposition meta={APP_ENTRIES.createSessionModal} />
      <LibraryEntryComposition meta={APP_ENTRIES.galleryFilterSection} />
      <LibraryEntryComposition meta={APP_ENTRIES.galleryFilterOverlay} />
    </LibrarySectionComposition>
  );
}

/* ─── Sekcja: Utility / Layout ─── */

export function UiLibrarySectionUtilityOrganism() {
  return (
    <LibrarySectionComposition id='utility' title='Utility / Layout'>
      <LibraryEntryComposition meta={UTILITY_ENTRIES.colorSwatch}>
        <DemoRowComposition label='interaktywny (selected + onClick), w ColorSwatchGrid'>
          <ColorSwatchDemo />
        </DemoRowComposition>
        <DemoRowComposition label='inline (statyczny, do podsumowań)'>
          <ColorSwatchMolecule name='Nude' hex='#e8c9b5' inline />
          <ColorSwatchMolecule name='Czerwony' hex='#a32638' inline />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={UTILITY_ENTRIES.imagePlaceholder}>
        <DemoRowComposition label='sm / md / lg'>
          <ImagePlaceholderAtom size='sm' />
          <ImagePlaceholderAtom size='md' />
          <ImagePlaceholderAtom size='lg' />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={UTILITY_ENTRIES.externalLink}
        note='Klik deleguje do platform/browser.openExternalUrl (in-app browser na natywce) — w bibliotece otwiera dokumentację w nowej karcie.'>
        <DemoRowComposition label='link zewnętrzny'>
          <ExternalLinkAtom href={BRAND_CONFIG.url}>
            Strona Nailfolio
          </ExternalLinkAtom>
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={UTILITY_ENTRIES.shareButton}>
        <DemoRowComposition label='domyślny / fullWidth'>
          <ShareButtonAtom
            url={BRAND_CONFIG.url}
            title='Portfolio stylistki'
            text='Zobacz moje stylizacje'
          />
          <ShareButtonAtom
            url={BRAND_CONFIG.url}
            title='Portfolio stylistki'
            fullWidth
          />
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={UTILITY_ENTRIES.errorBoundary} />
      <LibraryEntryComposition meta={UTILITY_ENTRIES.infiniteScrollTrigger} />
      <LibraryEntryComposition meta={UTILITY_ENTRIES.jsonLd} />
      <LibraryEntryComposition meta={UTILITY_ENTRIES.publicSeoHead} />
      <LibraryEntryComposition meta={UTILITY_ENTRIES.pii} />
      <LibraryEntryComposition meta={UTILITY_ENTRIES.turnstile} />
    </LibrarySectionComposition>
  );
}
