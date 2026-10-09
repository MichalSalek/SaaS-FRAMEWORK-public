import {
  CameraIcon,
  FunnelIcon,
  QrCodeIcon,
  PaperPlaneTiltIcon,
  DeviceMobileIcon,
  ChatCircleTextIcon,
} from '@phosphor-icons/react';

/* ─── Feature entries — parallel capabilities (GetAppPage) ─── */

export interface FeatureEntry {
  icon: React.ReactNode;
  titleKey: string;
  bodyKey: string;
}

/* DECISION (nie usuwaj tego komentarza):
   Lista funkcji jest JEDNORODNA — bez flag highlight/wide. Wcześniejszy
   zig-zag (nth-child wcięcia) + gold full-bleed band na itemie #4 czytały
   się jak osobna sekcja przerywająca listę i łamały wspólną lewą linię.
   Eyebrow ("Co dostajesz") + sześć równych editorial-rzędów z hairline'ami
   dają spójny rytm; gold-negatyw na stronie zostaje wyłącznie dla
   FinalCtaBand (ekonomia akcentu).
   Kolejność == priorytet czytania (jednorodne rzędy, ale pierwsze czyta się
   najczęściej): messaging (f06Title/Body = komunikator, filar r16/S82) siedzi
   NA 3. pozycji zaraz po parowaniu QR (photo → połącz → pisz z połączoną
   klientką), a nie na końcu jako dodatek. Klucz i18n zostaje `f06*` (rename
   dotknąłby generatora + mirrorów GEO bez zysku) — pozycja w tablicy jest
   niezależna od nazwy klucza. */
export const FEATURES: FeatureEntry[] = [
  {
    icon: <CameraIcon size={22} weight='regular' />,
    titleKey: 'features.f01Title',
    bodyKey: 'features.f01Body',
  },
  {
    icon: <QrCodeIcon size={22} weight='regular' />,
    titleKey: 'features.f02Title',
    bodyKey: 'features.f02Body',
  },
  {
    // Komunikator (filar r16/S82) — messaging podniesiony na 3. pozycję.
    icon: <ChatCircleTextIcon size={22} weight='regular' />,
    titleKey: 'features.f06Title',
    bodyKey: 'features.f06Body',
  },
  {
    icon: <FunnelIcon size={22} weight='regular' />,
    titleKey: 'features.f03Title',
    bodyKey: 'features.f03Body',
  },
  {
    icon: <PaperPlaneTiltIcon size={22} weight='regular' />,
    titleKey: 'features.f04Title',
    bodyKey: 'features.f04Body',
  },
  {
    icon: <DeviceMobileIcon size={22} weight='regular' />,
    titleKey: 'features.f05Title',
    bodyKey: 'features.f05Body',
  },
];

/* ─── FAQ q/a pairs (GetAppPage accordion; same keys feed FAQPage JSON-LD) ─── */

export interface FaqItem {
  questionKey: string;
  answerKey: string;
}

export const GET_APP_FAQ: FaqItem[] = [
  { questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { questionKey: 'faq.q5', answerKey: 'faq.a5' },
  { questionKey: 'faq.q6', answerKey: 'faq.a6' },
  { questionKey: 'faq.q7', answerKey: 'faq.a7' },
  { questionKey: 'faq.q8', answerKey: 'faq.a8' },
];
