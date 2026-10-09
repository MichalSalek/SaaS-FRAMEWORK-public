import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { SectionOrnamentMolecule } from '../../components/SectionOrnament/SectionOrnament.molecule';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { ScaleContactMolecule } from '../../components/ScaleContact/ScaleContact.molecule';
import { ShieldCheckIcon, ClockIcon, HeartIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
import { InkPanelAtom } from '../../components/InkPanel/InkPanel.atom';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { TrustSignalsMolecule } from '../../components/TrustSignals/TrustSignals.molecule';
import { TrustProseMolecule } from '../../components/TrustProse/TrustProse.molecule';
import { StatsBandMolecule } from '../../components/StatsBand/StatsBand.molecule';
import { StepsSectionOrganism } from '../../components/StepsSection/StepsSection.organism';
import {
  PhotoFinaleCtaAccent,
  PhotoFinaleCtaOrganism,
} from '../../components/PhotoFinaleCta/PhotoFinaleCta.organism';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { LP_ASSETS } from '../../assets/lpAssets';
import { LP_ENTRIES } from './uiLibrary.registry';
import {
  LibraryEntryComposition,
  LibrarySectionComposition,
  DemoRowComposition,
} from './UiLibraryEntry.composition';
import styles from './UiLibraryPage.module.css';

const FAQ_DEMO_ITEMS = [
  {
    id: 'free',
    question: 'Czy plan Free jest naprawdę darmowy?',
    answer: 'Tak, plan Free nie wymaga karty i zostaje za darmo na zawsze.',
    defaultOpen: true,
  },
  {
    id: 'photos',
    question: 'Ile zdjęć mogę wgrać?',
    answer: 'Limit zależy od planu; na start spokojnie zmieścisz portfolio.',
  },
  {
    id: 'clients',
    question: 'Jak klientki trafiają do mojej galerii?',
    answer: 'Linkiem do profilu albo przez parowanie kodem w aplikacji.',
  },
] as const;

export function UiLibrarySectionLpOrganism() {
  const appScreen = useAppScreenshots();
  return (
    <LibrarySectionComposition id='molecules-lp' title='Molecules LP (S22)'>
      <LibraryEntryComposition meta={LP_ENTRIES.paragraphLink}>
        <AppParagraphLinkAtom href='/pricing'>
          Zobacz plany
        </AppParagraphLinkAtom>
      </LibraryEntryComposition>
      <LibraryEntryComposition meta={LP_ENTRIES.sectionOrnament}>
        <SectionOrnamentMolecule src={LP_ASSETS.decor.nailOutline}>
          <p>Wybór stylizacji</p>
          <h3>Wzory z galerii stylistki</h3>
        </SectionOrnamentMolecule>
      </LibraryEntryComposition>
      <LibraryEntryComposition meta={LP_ENTRIES.processIllustration}>
        <ProcessIllustrationMolecule
          src={LP_ASSETS.process.stylistPortfolio}
          alt='Dodawanie prac do portfolio i wybór stylizacji przez klientkę'
        />
      </LibraryEntryComposition>
      <LibraryEntryComposition meta={LP_ENTRIES.scaleContact}>
        <ScaleContactMolecule
          title='Większy zespół?'
          description='Porozmawiajmy o planie dla Twojego salonu.'
          action='Skontaktuj się z nami'
        />
      </LibraryEntryComposition>
      <LibraryEntryComposition
        meta={LP_ENTRIES.lpHero}
        note='Komponent robi własny full-bleed (100vw breakout), więc demo celowo wystaje poza kartę wpisu. Uwaga na semantykę: bez eyebrowAs="h1" headline renderuje się jako h1 (na stronie może być dokładnie jeden), dlatego oba dema używają eyebrowAs="h1".'>
        <DemoRowComposition label='z media (dwie kolumny)' />
        <LpHeroOrganism
          eyebrow='Portfolio dla stylistek paznokci'
          eyebrowAs='h1'
          headline='Twoje stylizacje,'
          headlineAccent='zawsze pod ręką.'
          lede='Galeria prac, którą klientki przeglądają przed wizytą.'
          actions={
            <ButtonAtom variant='primary'>Załóż darmowe konto</ButtonAtom>
          }
          meta='Bez karty na start'
          media={
            <PhoneMockupMolecule
              label='Galeria stylistki'
              route='/app/gallery'
              screenshot={appScreen('appDashboard')}
            />
          }
          headingId='ui-lib-hero-media'
        />
        <DemoRowComposition label='bez media (jedna kolumna)' />
        <LpHeroOrganism
          eyebrow='Dla klientek'
          eyebrowAs='h1'
          headline='Znajdź swoją'
          headlineAccent='stylizację.'
          lede='Przeglądaj prace stylistek zanim umówisz wizytę.'
          actions={
            <ButtonAtom variant='outlined'>Otwórz na telefonie</ButtonAtom>
          }
          headingId='ui-lib-hero-plain'
        />
      </LibraryEntryComposition>
      <LibraryEntryComposition meta={LP_ENTRIES.inkPanel}>
        <DemoRowComposition label='tone ink (default)' />
        <InkPanelAtom>
          <div className={styles.inkDemoContent}>
            <p className={styles.inkDemoTitle}>Zamknięty ink-prostokąt</p>
            <p className={styles.inkDemoBody}>
              Panel daje pole, ramę i kolor tekstu; układ wnętrza należy do
              strony.
            </p>
          </div>
        </InkPanelAtom>
        <DemoRowComposition label='tone violet' />
        <InkPanelAtom tone='violet'>
          <div className={styles.inkDemoContent}>
            <p className={styles.inkDemoTitle}>Wariant fioletowej karty</p>
            <p className={styles.inkDemoBody}>
              Ten sam kontrakt, paleta secondary (AA-pogłębiona w light mode).
            </p>
          </div>
        </InkPanelAtom>
      </LibraryEntryComposition>
      <LibraryEntryComposition meta={LP_ENTRIES.faqSection}>
        <FaqSectionMolecule
          eyebrow='FAQ'
          title='Najczęstsze pytania'
          lede='Trzy przykładowe pozycje; pierwsza otwarta przez defaultOpen.'
          items={FAQ_DEMO_ITEMS}
          headingId='ui-lib-faq'
          idPrefix='ui-lib-faq'
        />
      </LibraryEntryComposition>
      <LibraryEntryComposition meta={LP_ENTRIES.trustSignals}>
        <DemoRowComposition label='pills' />
        <TrustSignalsMolecule
          ariaLabel='Sygnały zaufania'
          items={[
            { icon: <ShieldCheckIcon size={16} />, text: 'RODO i serwery UE' },
            { icon: <ClockIcon size={16} />, text: 'Start w 5 minut' },
            { text: 'Bez karty na start' },
          ]}
        />
        <DemoRowComposition label='grid' />
        <TrustSignalsMolecule
          variant='grid'
          ariaLabel='Sygnały zaufania w siatce'
          items={[
            { icon: <ShieldCheckIcon size={20} />, text: 'RODO i serwery UE' },
            { icon: <ClockIcon size={20} />, text: 'Start w 5 minut' },
            { icon: <HeartIcon size={20} />, text: 'Wsparcie po polsku' },
          ]}
        />
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={LP_ENTRIES.trustProse}>
        <TrustProseMolecule
          sentence={
            <>
              Zbudowane w Polsce ze stylistkami. Płatności przez <em>Stripe</em>
              , dane w <em>Unii Europejskiej</em>, <em>30 dni</em> Pro za darmo.
            </>
          }
          note='Ceny netto (nie zawierają VAT)'
        />
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={LP_ENTRIES.statsBand}>
        <DemoRowComposition label='ink-card (kanon)' />
        <StatsBandMolecule
          heading='Liczby z bety'
          headingId='ui-lib-stats'
          items={[
            { figure: '10', label: 'stylistek w pakiecie studia' },
            { figure: '5 min', label: 'od konta do pierwszych zdjęć' },
            {
              figure: '0 zł',
              label: 'plan Free',
              footnote: 'bez karty, na zawsze',
            },
          ]}
        />
        <DemoRowComposition label='plain-row' />
        <StatsBandMolecule
          variant='plain-row'
          items={[
            { figure: '2026', label: 'rok startu' },
            { figure: '3', label: 'języki aplikacji' },
            { figure: '1', label: 'misja: portfolio, nie social' },
          ]}
        />
      </LibraryEntryComposition>

      <LibraryEntryComposition meta={LP_ENTRIES.stepsSection}>
        <DemoRowComposition label='list (kanon get-app / home)' />
        <StepsSectionOrganism
          steps={[
            {
              title: 'Załóż konto',
              body: 'E-mail wystarczy, bez hasła i bez karty.',
            },
            {
              title: 'Wgraj prace',
              body: 'Zdjęcia z telefonu, tagi długości i stylu.',
            },
            {
              title: 'Podziel się linkiem',
              body: 'Klientki przeglądają portfolio przed wizytą.',
            },
          ]}
        />
        <DemoRowComposition label='columns' />
        <StepsSectionOrganism
          variant='columns'
          steps={[
            { title: 'Otwórz na telefonie' },
            { title: 'Sparuj się ze stylistką' },
            { title: 'Przeglądaj stylizacje' },
          ]}
        />
      </LibraryEntryComposition>

      <LibraryEntryComposition
        meta={LP_ENTRIES.photoFinaleCta}
        note='Korzeń to width:100% (rodzic LP już jest bleed). Dwa imageSide bez ręcznego headingId: useId daje unikalne id przy powtórzonym renderze. Hook --photo-finale-photo-min-block ściska kadr w katalogu; na stronach zostaje skala home.'>
        <DemoRowComposition label="imageSide='left' (home)" />
        <PhotoFinaleCtaOrganism
          imageSide='left'
          imageSrc={LP_ASSETS.cta.beautyNailsHomeCta03RedSilk}
          style={{
            '--photo-finale-photo-min-block': 'clamp(220px, 28vw, 320px)',
          }}
          heading={
            <>
              Twoje stylizacje zasługują
              <br />
              <PhotoFinaleCtaAccent>na własne portfolio.</PhotoFinaleCtaAccent>
            </>
          }
          body='Załóż konto i wgraj pierwsze zdjęcia w kilka minut.'
          actions={
            <>
              <ButtonAtom variant='primary'>Załóż darmowe konto</ButtonAtom>
              <a href='#molecules-lp'>Zobacz cennik</a>
            </>
          }
          footnote='Bez karty na start. Plan Free zostaje za darmo.'
        />
        <DemoRowComposition label="imageSide='right' (for-clients)" />
        <PhotoFinaleCtaOrganism
          imageSide='right'
          imageSrc={LP_ASSETS.cta.beautyDiv02TwoHands}
          style={{
            '--photo-finale-photo-min-block': 'clamp(220px, 28vw, 320px)',
          }}
          heading={
            <>
              Znajdź swoją
              <br />
              <PhotoFinaleCtaAccent>ulubioną stylizację.</PhotoFinaleCtaAccent>
            </>
          }
          body='Przeglądaj prace stylistki zanim umówisz wizytę.'
          actions={
            <>
              <ButtonAtom variant='primary'>Otwórz na telefonie</ButtonAtom>
              <a href='#molecules-lp'>Zaloguj przez przeglądarkę</a>
            </>
          }
          footnote='Konto jest darmowe. Nic nie instalujesz.'
        />
      </LibraryEntryComposition>
    </LibrarySectionComposition>
  );
}
