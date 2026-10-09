import { useState } from 'react';
import { BrandLockupMolecule } from '../../components/BrandLockup/BrandLockup.molecule';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import { ButtonAtom } from '../../components/Button/Button.atom';
import {
  CardMolecule,
  CardHeaderAtom,
  CardContentAtom,
  CardActionsAtom,
} from '../../components/Card/Card.molecule';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import {
  AccordionItemMolecule,
  type AccordionItemClassNames,
} from '../../components/Accordion/AccordionItem.molecule';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { MOLECULE_ENTRIES } from './uiLibrary.registry';
import {
  LibraryEntryComposition,
  LibrarySectionComposition,
  DemoRowComposition,
} from './UiLibraryEntry.composition';
import styles from './UiLibraryPage.module.css';

/** Minimalna skórka demo dla gołego AccordionItem (na LP rządzi FaqSection). */
const ACC_CLASSES: AccordionItemClassNames = {
  item: styles.accItem,
  trigger: styles.accTrigger,
  chevron: styles.accChevron,
  content: styles.accContent,
  answer: styles.accAnswer,
};

function SegmentedControlDemo() {
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [filter, setFilter] = useState<'all' | 'open'>('all');
  return (
    <>
      <DemoRowComposition label='pill, md'>
        <SegmentedControlMolecule
          ariaLabel='Zakres czasu'
          value={range}
          onChange={setRange}
          options={[
            { value: '7d', label: '7 dni' },
            { value: '30d', label: '30 dni' },
            { value: '90d', label: '90 dni' },
          ]}
        />
      </DemoRowComposition>
      <DemoRowComposition label='control, sm, licznik'>
        <SegmentedControlMolecule
          ariaLabel='Filtr zgłoszeń'
          size='sm'
          shape='control'
          semantics='tabs'
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Wszystkie', count: 12 },
            { value: 'open', label: 'Otwarte', count: 3 },
          ]}
        />
      </DemoRowComposition>
    </>
  );
}

export function UiLibrarySectionMoleculesOrganism() {
  const appScreen = useAppScreenshots();
  return (
    <LibrarySectionComposition id='molecules' title='Molecules (S19-S21)'>
      <LibraryEntryComposition meta={MOLECULE_ENTRIES.brandLockup}>
        <DemoRowComposition label='sygnet + Nailfolio (navbar twin)'>
          <BrandLockupMolecule />
        </DemoRowComposition>
      </LibraryEntryComposition>
      <LibraryEntryComposition meta={MOLECULE_ENTRIES.card}>
        <DemoRowComposition label='warianty: outlined / elevated / highlighted'>
          <div className={styles.cardRow}>
            <CardMolecule variant='outlined'>
              <CardContentAtom>
                Karta outlined — domyślna ramka hairline.
              </CardContentAtom>
            </CardMolecule>
            <CardMolecule variant='elevated'>
              <CardContentAtom>
                Karta elevated — neutralny tonal step (surface-input) +
                hairline, bez cienia.
              </CardContentAtom>
            </CardMolecule>
            <CardMolecule variant='outlined' highlighted>
              <CardContentAtom>
                Karta highlighted — pogrubiona ramka akcentu.
              </CardContentAtom>
            </CardMolecule>
          </div>
        </DemoRowComposition>
        <DemoRowComposition label='złożona: CardHeader + CardContent + CardActions'>
          <div className={styles.cardRow}>
            <CardMolecule variant='elevated'>
              <CardHeaderAtom>Twoje portfolio</CardHeaderAtom>
              <CardContentAtom>
                Wgrywasz zdjęcia raz, a klientki przeglądają je, kiedy szukają
                stylizacji.
              </CardContentAtom>
              <CardActionsAtom>
                <ButtonAtom variant='primary' size='sm'>
                  Dodaj zdjęcie
                </ButtonAtom>
                <ButtonAtom variant='text' size='sm'>
                  Później
                </ButtonAtom>
              </CardActionsAtom>
            </CardMolecule>
          </div>
        </DemoRowComposition>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={MOLECULE_ENTRIES.sectionHeader}>
        <DemoRowComposition label='align start (default)' />
        <SectionHeaderMolecule
          eyebrow='Jak to działa'
          title='Portfolio, które pracuje za Ciebie'>
          Wgrywasz zdjęcia raz, a klientki przeglądają je wtedy, kiedy szukają
          stylizacji.
        </SectionHeaderMolecule>
        <DemoRowComposition label='align center + eyebrow chip' />
        <SectionHeaderMolecule
          align='center'
          eyebrowVariant='chip'
          eyebrow='Cennik'
          title='Jeden plan, zero niespodzianek'
        />
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={MOLECULE_ENTRIES.errorState}>
        <DemoRowComposition label='z przyciskiem retry (query.refetch)' />
        <ErrorStateMolecule
          message='Nie udało się wczytać rozmowy.'
          retryLabel='Spróbuj ponownie'
          onRetry={() => undefined}
        />
        <DemoRowComposition label='sam komunikat (bez onRetry)' />
        <ErrorStateMolecule message='Nie udało się załadować listy zespołu.' />
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={MOLECULE_ENTRIES.finalCtaBand}
        note='Komponent robi własny full-bleed (100vw breakout), więc band celowo wystaje poza kartę wpisu — na stronie kotwiczy się do krawędzi viewportu. Niżej oba tony F3: gold (konwersyjny) i ink (informacyjny).'>
        <FinalCtaBandOrganism
          eyebrow='Zacznij dziś'
          headlineLine1='Twoje stylizacje zasługują'
          headlineAccent='na własne portfolio.'
          body='Załóż konto i wgraj pierwsze zdjęcia w kilka minut.'
          actions={
            <ButtonAtom variant='primary'>Załóż darmowe konto</ButtonAtom>
          }
          secondary={<a href='#molecules'>Zobacz, jak to działa</a>}
          footnote='Bez karty na start. Plan Free zostaje za darmo.'
          headingId='ui-lib-final-cta'
        />
        <DemoRowComposition label="tone='ink' — spokojne zamknięcie strony informacyjnej (F3)" />
        <FinalCtaBandOrganism
          tone='ink'
          eyebrow='Zacznij dziś'
          headlineLine1='Twoje stylizacje zasługują'
          headlineAccent='na własne portfolio.'
          body='Załóż konto i wgraj pierwsze zdjęcia w kilka minut.'
          actions={
            <ButtonAtom variant='primary'>Załóż darmowe konto</ButtonAtom>
          }
          secondary={<a href='#molecules'>Zobacz, jak to działa</a>}
          footnote='Bez karty na start. Plan Free zostaje za darmo.'
          headingId='ui-lib-final-cta-ink'
        />
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={MOLECULE_ENTRIES.phoneMockup}>
        <div className={styles.phoneRow}>
          <PhoneMockupMolecule
            label='Galeria stylistki'
            route='/app/gallery'
            state='stylistka, 12 zdjęć'
            screenshot={appScreen('appDashboard')}
          />
          <PhoneMockupMolecule
            label='Parowanie z klientką (honest placeholder)'
            route='/app/pairing'
          />
        </div>
        <DemoRowComposition label='po lewej: realny screenshot, po prawej: honest placeholder (bez screena); podpisy figcaption usunięte na stałe (głos ownera S24), opis żyje w aria-label' />
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={MOLECULE_ENTRIES.accordionItem}
        note='Skórka poniżej jest lokalna dla biblioteki (slot classNames) — kanoniczną skórkę FAQ niesie FaqSection w sekcji Molecules LP.'>
        <div>
          <AccordionItemMolecule
            idPrefix='ui-lib-acc'
            index={0}
            question='Czy mogę wypróbować za darmo?'
            answer='Tak, plan Free nie wymaga karty i zostaje za darmo na zawsze.'
            classNames={ACC_CLASSES}
            defaultOpen
          />
          <AccordionItemMolecule
            idPrefix='ui-lib-acc'
            index={1}
            question='Jak klientka znajdzie moje portfolio? (zamknięty)'
            answer='Wysyłasz jej link albo parujecie się kodem w aplikacji.'
            classNames={ACC_CLASSES}
          />
        </div>
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={MOLECULE_ENTRIES.stickyCtaBar}
        note='Komponent ma position: fixed — demo poniżej jest uwięzione w ramce przez transform na kontenerze (fixed liczy się względem ramki, nie viewportu). Na stronie dokleja się do dołu ekranu, a visible steruje wjazdem od dołu.'>
        <div className={styles.fixedScope}>
          <StickyCtaBarMolecule
            visible
            text='Gotowa na własne portfolio?'
            buttonText='Załóż konto'
            onButtonClick={() => undefined}
          />
        </div>
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={MOLECULE_ENTRIES.priceSlot} />

      <LibraryEntryComposition meta={MOLECULE_ENTRIES.segmentedControl}>
        <SegmentedControlDemo />
      </LibraryEntryComposition>
    </LibrarySectionComposition>
  );
}
