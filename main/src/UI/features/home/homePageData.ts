/* ─── Static data for HomePage sections ─── */

export const STEPS = [
  {
    n: '01',
    titleKey: 'steps.step1Title',
    bodyKey: 'steps.step1Body',
  },
  {
    n: '02',
    titleKey: 'steps.step2Title',
    bodyKey: 'steps.step2Body',
  },
  {
    n: '03',
    titleKey: 'steps.step3Title',
    bodyKey: 'steps.step3Body',
  },
] as const;

/* Bento tiles are parallel benefits, not a sequence. Their titles carry the
 * content directly; the labels above them were removed on 2026-10-10.
 *
 * `span`: 'long' (4 of 6 grid cols) | 'short' (2 cols). Rows alternate
 * long|short ↔ short|long so the mosaic reads with variable rhythm and never
 * leaves a full-width tile with empty space:
 *   row1 [gallery:long | history:short]
 *   row2 [QR:short | session:long]
 *   row3 [commission-ink:long | team:short]
 *
 * `highlight` = deep-ink color-block (the one dark beat / contrast atut).
 * `wide` = renders the Session Share QR-flow visual (needs the long span). */
export const BENEFITS = [
  {
    n: 'b1',
    titleIcon: 'filter',
    titleKey: 'benefits.b1Title',
    bodyKey: 'benefits.b1Body',
    span: 'long' as const,
    wide: false,
    highlight: false,
  },
  {
    n: 'b2',
    titleIcon: 'notepad',
    titleKey: 'benefits.b2Title',
    bodyKey: 'benefits.b2Body',
    span: 'short' as const,
    wide: false,
    highlight: false,
  },
  {
    n: 'b3',
    titleIcon: 'qr',
    titleKey: 'benefits.b3Title',
    bodyKey: 'benefits.b3Body',
    span: 'short' as const,
    wide: false,
    highlight: false,
  },
  {
    n: 'b4',
    titleIcon: 'share',
    titleKey: 'benefits.b4Title',
    bodyKey: 'benefits.b4Body',
    span: 'long' as const,
    wide: true,
    highlight: false,
  },
  {
    n: 'b5',
    titleIcon: 'money',
    titleKey: 'benefits.b5Title',
    bodyKey: 'benefits.b5Body',
    span: 'long' as const,
    wide: false,
    highlight: true,
  },
  {
    /* This tile is MESSAGING: the benefits headline promises „rozmowa o wizycie”,
     * so a tile must show it. */
    n: 'b6',
    titleIcon: 'chat',
    titleKey: 'benefits.b6Title',
    bodyKey: 'benefits.b6Body',
    span: 'short' as const,
    wide: false,
    highlight: false,
  },
] as const;

export const PAIN_POINTS = [
  { id: 'p1', titleKey: 'pain.pain1', icon: 'pinterest' as const },
  { id: 'p2', titleKey: 'pain.pain2', icon: 'algorithm' as const },
  { id: 'p3', titleKey: 'pain.pain3', icon: 'memory' as const },
] as const;

export const FAQ_ITEMS = [
  // f0 = the entity-definition question (a signal for AI overviews / LLMs: "nailfolio"
  // is sometimes confused with physical swatch sets); deliberately FIRST in the list.
  { id: 'f0', questionKey: 'faq.q0', answerKey: 'faq.a0' },
  { id: 'f1', questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { id: 'f2', questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { id: 'f3', questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { id: 'f4', questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { id: 'f5', questionKey: 'faq.q5', answerKey: 'faq.a5' },
] as const;

export const FIT_ITEMS = [
  {
    id: 'instagram',
    icon: 'instagram' as const,
    titleKey: 'fit.instagramTitle',
    bodyKey: 'fit.instagramBody',
    proofKey: 'fit.instagramProof',
  },
  {
    id: 'phoneRoll',
    icon: 'phoneRoll' as const,
    titleKey: 'fit.phoneRollTitle',
    bodyKey: 'fit.phoneRollBody',
    proofKey: 'fit.phoneRollProof',
  },
  {
    id: 'booking',
    icon: 'booking' as const,
    titleKey: 'fit.bookingTitle',
    bodyKey: 'fit.bookingBody',
    proofKey: 'fit.bookingProof',
  },
  {
    id: 'nailfolio',
    icon: 'nailfolio' as const,
    titleKey: 'fit.nailfolioTitle',
    bodyKey: 'fit.nailfolioBody',
    proofKey: 'fit.nailfolioProof',
  },
] as const;
