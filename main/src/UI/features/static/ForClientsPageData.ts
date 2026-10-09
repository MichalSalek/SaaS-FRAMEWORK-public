import { LP_ASSETS } from '../../assets/lpAssets';

/* ─── How it works — 3 steps ───
 * DECISION (nie usuwaj tego komentarza):
 * QR_STEPS zasila WYŁĄCZNIE HowTo JSON-LD w pages/for-clients.tsx (SEO).
 * Wizualna sekcja "3 kroki" została usunięta ze strony (S22) — duplikowała
 * podróż visit-moments (ten sam flow QR → filtry → sesja) i łamała skalę
 * numerałów. NIE podpinać z powrotem do UI; klucze i18n `how.step*` żyją
 * dla JSON-LD, `how.footnote` renderuje stopka sekcji visit-moments. */
export interface StepEntry {
  n: string;
  titleKey: string;
  bodyKey: string;
  wide?: boolean;
}

export const QR_STEPS: StepEntry[] = [
  {
    n: '01',
    titleKey: 'how.step01Title',
    bodyKey: 'how.step01Body',
  },
  {
    n: '02',
    titleKey: 'how.step02Title',
    bodyKey: 'how.step02Body',
  },
  {
    n: '03',
    titleKey: 'how.step03Title',
    bodyKey: 'how.step03Body',
    wide: true,
  },
];

/* ─── Benefits ─── */
export interface BenefitEntry {
  n: string;
  titleKey: string;
  bodyKey: string;
  detailKey?: string;
  highlight?: boolean;
}

/* DECISION (nie usuwaj tego komentarza):
 * Kolejność = waga wizualna (Benefits = parallel features, bez numerałów —
 * render w ForClientsBenefitsSectionOrganism). S81 (/ui 2026-07-18): b06
 * (Wiadomości) PODNIESIONE na 2. pozycję — copy r16 pozycjonuje komunikator
 * klientka↔stylistka jako FILAR relacji, render trzymał go przedostatnim.
 * Highlight b05 (sesja inspiracji) zostaje OSTATNI = gold-block domknięcie. */
export const BENEFITS: BenefitEntry[] = [
  {
    n: '01',
    titleKey: 'benefits.b01Title',
    bodyKey: 'benefits.b01Body',
    detailKey: 'benefits.b01Detail',
  },
  {
    n: '06',
    titleKey: 'benefits.b06Title',
    bodyKey: 'benefits.b06Body',
  },
  {
    n: '02',
    titleKey: 'benefits.b02Title',
    bodyKey: 'benefits.b02Body',
  },
  {
    n: '03',
    titleKey: 'benefits.b03Title',
    bodyKey: 'benefits.b03Body',
    detailKey: 'benefits.b03Detail',
  },
  {
    n: '04',
    titleKey: 'benefits.b04Title',
    bodyKey: 'benefits.b04Body',
  },
  {
    n: '05',
    titleKey: 'benefits.b05Title',
    bodyKey: 'benefits.b05Body',
    detailKey: 'benefits.b05Detail',
    highlight: true,
  },
];

export const VISIT_MOMENTS = [
  {
    id: 'salon',
    titleKey: 'visitMoments.m01Title',
    bodyKey: 'visitMoments.m01Body',
    metaKey: 'visitMoments.m01Meta',
  },
  {
    id: 'choice',
    titleKey: 'visitMoments.m02Title',
    bodyKey: 'visitMoments.m02Body',
    metaKey: 'visitMoments.m02Meta',
  },
  {
    id: 'share',
    titleKey: 'visitMoments.m03Title',
    bodyKey: 'visitMoments.m03Body',
    metaKey: 'visitMoments.m03Meta',
  },
  {
    id: 'aftervisit',
    titleKey: 'visitMoments.m04Title',
    bodyKey: 'visitMoments.m04Body',
    metaKey: 'visitMoments.m04Meta',
  },
] as const;

/* ─── Client FAQ ─── */
export interface ClientFaqItem {
  id: string;
  questionKey: string;
  answerKey: string;
}

export const CLIENT_FAQ: readonly ClientFaqItem[] = [
  { id: 'q01', questionKey: 'faq.q01Question', answerKey: 'faq.q01Answer' },
  { id: 'q02', questionKey: 'faq.q02Question', answerKey: 'faq.q02Answer' },
  { id: 'q03', questionKey: 'faq.q03Question', answerKey: 'faq.q03Answer' },
  { id: 'q04', questionKey: 'faq.q04Question', answerKey: 'faq.q04Answer' },
  { id: 'q05', questionKey: 'faq.q05Question', answerKey: 'faq.q05Answer' },
  { id: 'q06', questionKey: 'faq.q06Question', answerKey: 'faq.q06Answer' },
  { id: 'q07', questionKey: 'faq.q07Question', answerKey: 'faq.q07Answer' },
  { id: 'q08', questionKey: 'faq.q08Question', answerKey: 'faq.q08Answer' },
] as const;

/* ─── Discovery — real inspiration tiles (assets + i18n labels) ─── */
export const DISCOVERY_TILES = [
  { src: LP_ASSETS.portfolio.nailDiscover01, labelKey: 'discovery.tile1' },
  { src: LP_ASSETS.portfolio.nailDiscover02, labelKey: 'discovery.tile2' },
  { src: LP_ASSETS.portfolio.nailDiscover03, labelKey: 'discovery.tile3' },
  {
    src: LP_ASSETS.portfolio.manicure08,
    labelKey: 'discovery.tile4',
  },
] as const;

/* ─── Privacy mini-section items ─── */
export const PRIVACY_ITEMS = [
  { id: 'p01', textKey: 'privacy.item1' },
  { id: 'p02', textKey: 'privacy.item2' },
  { id: 'p03', textKey: 'privacy.item3' },
] as const;
