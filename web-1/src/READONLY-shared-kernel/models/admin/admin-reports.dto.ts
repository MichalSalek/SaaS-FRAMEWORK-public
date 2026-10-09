import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { PricingPlan } from '../../domain/pricing/pricing.config';
import type { ReportPeriodKey } from '../../domain/admin/reports.config';

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

type AdminGetReportsResponse = {
  period: ReportPeriod;
  period_start: string;
  period_end: string;
  funnel: {
    total_registrations: MetricWithChange;
    active_accounts: MetricWithChange;
    paid_accounts: MetricWithChange;
    conversion_to_active_percent: number;
    conversion_to_paid_percent: number;
  };
  retention: {
    active_7d: number;
    active_30d: number;
    total_users: number;
    retention_7d_percent: number;
    retention_30d_percent: number;
  };
  revenue: {
    users_free: number;
    users_pro: number;
    users_pro_plus: number;
    users_studio: number;
    users_scale: number;
    mrr_estimate: number;
  };
  growth: {
    new_users_per_day: GrowthDataPoint[];
  };
  top_stylists: TopStylist[];
  churn: {
    disabled_in_period: MetricWithChange;
    deleted_in_period: MetricWithChange;
  };
  cached_at: string;
};

export type AdminReportsDtoApi = {
  /** Zwraca metryki i raporty za wskazany okres (lejek, retencja, przychód, wzrost, churn, top styliści). */
  ADMIN_GET_REPORTS: {
    REQUEST: { period: ReportPeriod };
    RESPONSE: AdminGetReportsResponse;
    RESPONSE_ERROR: DetailedErrorPayload<{ period: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { period: ReportPeriod },
      AdminGetReportsResponse,
      DetailedErrorPayload<{ period: string }>
    >;
  };
};
