import { SectionComposition } from '../../components/Section/Section.composition';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { TrustStatsSectionOrganism } from '../../components/TrustStatsSection/TrustStatsSection.organism';
import { PhoneQuoteStripOrganism } from '../../components/PhoneQuoteStrip/PhoneQuoteStrip.organism';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { COMPOSITION_ENTRIES } from './uiLibrary.registry';
import {
  LibraryEntryComposition,
  LibrarySectionComposition,
  DemoRowComposition,
} from './UiLibraryEntry.composition';

export function UiLibrarySectionCompositionsOrganism() {
  const appScreen = useAppScreenshots();
  return (
    <LibrarySectionComposition id='compositions' title='Kompozycje (S24)'>
      <LibraryEntryComposition
        meta={COMPOSITION_ENTRIES.section}
        note='Komponent robi własny full-bleed (100vw breakout), więc demo celowo wystaje poza kartę wpisu — tak samo zachowa się na stronie. Wymaga overflow-x: clip na .content layoutu (PublicLayout, fix S23).'>
        <DemoRowComposition label='tone subtle (band + pełna rama hairline + kontener)' />
        <SectionComposition tone='subtle' aria-label='Demo Section tone subtle'>
          <SectionHeaderMolecule title='Treść siedzi w kontenerze --lp-content-width'>
            Band rozciąga się na 100vw z pełną ramą hairline top+bottom; strona
            dostarcza wyłącznie wnętrze (header + grid), bez kopiowania
            breakoutu.
          </SectionHeaderMolecule>
        </SectionComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={COMPOSITION_ENTRIES.trustStatsSection}
        note='Kompozycja zbudowana NA Section (tone subtle) + StatsBand (ink-card) — demo wystaje poza kartę wpisu jak każdy full-bleed band. Używana na home i for-stylists; treść w demo przykładowa.'>
        <DemoRowComposition label='kanon home (nazwa regionu + body + 3 staty)' />
        <TrustStatsSectionOrganism
          ariaLabel='Dlaczego można nam zaufać'
          body='Portfolio bez lajków i algorytmów: Twoje prace, Twoje klientki, zero rozpraszaczy.'
          stats={[
            { figure: '0%', label: 'reklam i algorytmów' },
            { figure: '100%', label: 'Twoich prac w jednym miejscu' },
            { figure: '5 min', label: 'od konta do pierwszych zdjęć' },
          ]}
        />
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={COMPOSITION_ENTRIES.phoneQuoteStrip}
        note='Forma 1:1 z głosowanego wariantu S24/1-B (owner kazał zachować mimo wygranej A); treść w demo przykładowa, na stronie przychodzi z i18n.'>
        <DemoRowComposition label='pas screen + benefit-cytat (0.9/1.4, hairline-karta)' />
        <PhoneQuoteStripOrganism
          phone={{
            label: 'Galeria stylistki w aplikacji',
            route: '/app',
            screenshot: appScreen('appDashboard'),
          }}
          quoteTitle={
            <>
              <em>Jedna sesja inspiracji</em> zamiast dziesięciu zrzutów ekranu
            </>
          }
          quoteBody='Twoja stylistka dostaje kompletną sesję inspiracji, zdjęcia z notatkami, a nie pojedynczy zrzut ekranu.'
          quoteNote='Stylistka otwiera jedną sesję i widzi wszystko: zdjęcia, notatki, kolejność.'
        />
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={COMPOSITION_ENTRIES.reviewsSection} />
    </LibrarySectionComposition>
  );
}
