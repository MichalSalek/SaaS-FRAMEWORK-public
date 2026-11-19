/* ─── Comparison table rows (4 wiersze × 3 kolumny narzędzi) ─── */
export interface CompareTableRow {
  labelKey: string;
  bookingKey: string;
  socialKey: string;
  nailfolioKey: string;
}

export const COMPARE_TABLE_ROWS = [
  {
    labelKey: 'table.rowPurposeLabel',
    bookingKey: 'table.rowPurposeBooking',
    socialKey: 'table.rowPurposeSocial',
    nailfolioKey: 'table.rowPurposeNailfolio',
  },
  {
    labelKey: 'table.rowClientLabel',
    bookingKey: 'table.rowClientBooking',
    socialKey: 'table.rowClientSocial',
    nailfolioKey: 'table.rowClientNailfolio',
  },
  {
    labelKey: 'table.rowCostLabel',
    bookingKey: 'table.rowCostBooking',
    socialKey: 'table.rowCostSocial',
    nailfolioKey: 'table.rowCostNailfolio',
  },
  {
    labelKey: 'table.rowMemoryLabel',
    bookingKey: 'table.rowMemoryBooking',
    socialKey: 'table.rowMemorySocial',
    nailfolioKey: 'table.rowMemoryNailfolio',
  },
] as const satisfies readonly CompareTableRow[];

/* ─── Contrast sections — Nailfolio obok konkretnego narzędzia ─── */
export interface CompareContrastEntry {
  id: 'booking' | 'social' | 'pinterest';
  headlineKey: string;
  body1Key: string;
  body2Key: string;
  /** The pinterest section has no proof line in copy, so the key is optional. */
  proofKey?: string;
}

const COMPARE_CONTRAST_SECTIONS_DATA = [
  {
    id: 'booking',
    headlineKey: 'booking.headline',
    body1Key: 'booking.body1',
    body2Key: 'booking.body2',
    proofKey: 'booking.proof',
  },
  {
    id: 'social',
    headlineKey: 'social.headline',
    body1Key: 'social.body1',
    body2Key: 'social.body2',
    proofKey: 'social.proof',
  },
  {
    id: 'pinterest',
    headlineKey: 'pinterest.headline',
    body1Key: 'pinterest.body1',
    body2Key: 'pinterest.body2',
  },
] as const satisfies readonly CompareContrastEntry[];
export const COMPARE_CONTRAST_SECTIONS: readonly (CompareContrastEntry &
  (typeof COMPARE_CONTRAST_SECTIONS_DATA)[number])[] =
  COMPARE_CONTRAST_SECTIONS_DATA;

/* ─── FAQ data ─── */
export interface CompareFaqItem {
  questionKey: string;
  answerKey: string;
}

/* Ten sam array zasila FAQPage JSON-LD (buildCompareFaqJsonLd .map) — render
 * i schema są z definicji spójne (jeden SoT, wzorzec OBJECTION_FAQ). */
export const COMPARE_FAQ = [
  { questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { questionKey: 'faq.q5', answerKey: 'faq.a5' },
  { questionKey: 'faq.q6', answerKey: 'faq.a6' },
] as const satisfies readonly CompareFaqItem[];
