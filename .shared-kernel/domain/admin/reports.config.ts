import type { ReportPeriodValue } from './admin.config';

// SSOT kluczy okresów = REPORT_PERIODS array w admin.config.ts.
// `satisfies Record<ReportPeriodValue, ...>` wymusza pełną synchronizację:
// brakujący/nadmiarowy klucz tutaj = błąd kompilacji (zero driftu).
export const REPORT_PERIODS = {
  week: { days: 7, label: 'Ostatnie 7 dni' },
  month: { days: 30, label: 'Ostatnie 30 dni' },
  quarter: { days: 90, label: 'Ostatnie 90 dni' },
} as const satisfies Record<ReportPeriodValue, { days: number; label: string }>;

export type ReportPeriodKey = ReportPeriodValue;
