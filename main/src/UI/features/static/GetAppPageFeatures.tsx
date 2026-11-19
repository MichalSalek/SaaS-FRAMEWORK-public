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

/* DECISION: six equal hairline rows with the icon in a left rail and a sticky screen,
   no highlight/wide flags, zig-zag or full-bleed band (owner vote, variant B). Two
   plain group headings split what the stylist does from what her client does. The
   messenger (`f06*`) is the stylist's third action; reading order does not follow
   key names. */
export interface FeatureGroupEntry {
  headingKey: string;
  headingId: string;
  entries: FeatureEntry[];
}

export const FEATURE_GROUPS = [
  {
    headingKey: 'features.stylistGroupHeading',
    headingId: 'getapp-stylist-features-heading',
    entries: [
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
        icon: <ChatCircleTextIcon size={22} weight='regular' />,
        titleKey: 'features.f06Title',
        bodyKey: 'features.f06Body',
      },
    ],
  },
  {
    headingKey: 'features.clientGroupHeading',
    headingId: 'getapp-client-features-heading',
    entries: [
      {
        icon: <DeviceMobileIcon size={22} weight='regular' />,
        titleKey: 'features.f05Title',
        bodyKey: 'features.f05Body',
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
    ],
  },
] as const satisfies readonly FeatureGroupEntry[];

/* ─── FAQ q/a pairs (GetAppPage accordion; same keys feed FAQPage JSON-LD) ─── */

export interface FaqItem {
  questionKey: string;
  answerKey: string;
}

export const GET_APP_FAQ = [
  { questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { questionKey: 'faq.q5', answerKey: 'faq.a5' },
  { questionKey: 'faq.q6', answerKey: 'faq.a6' },
  { questionKey: 'faq.q7', answerKey: 'faq.a7' },
  { questionKey: 'faq.q8', answerKey: 'faq.a8' },
] as const satisfies readonly FaqItem[];
