import type { ReportPeriodKey } from '../../domain/admin/reports.config';
import type { PricingPlan } from '../../domain/pricing/pricing.config';

// Reports types — derived from REPORT_PERIODS config (SSOT)
export type ReportPeriod = ReportPeriodKey;

export type MetricWithChange = {
  current: number;
  previous: number;
  change_percent: number | null;
};

export type GrowthDataPoint = {
  date: string;
  count: number;
};

export type TopStylist = {
  account_id: string;
  display_name: string | null;
  gallery_record_count: number;
  pricing_plan: PricingPlan;
};
