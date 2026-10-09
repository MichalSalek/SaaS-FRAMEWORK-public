import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

const NEON_API_BASE = 'https://console.neon.tech/api/v2';
const CHECK_INTERVAL_MS = 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_BUDGET_CU_HOURS = 100;
const CRITICAL_USAGE_PERCENT = 85;

type NeonProjectUsageResponse = {
  project?: {
    compute_time_seconds?: unknown;
    consumption_period_start?: unknown;
    consumption_period_end?: unknown;
  };
};

export type NeonComputeQuotaResult = Readonly<{
  state: 'healthy' | 'critical';
  usedCuHours: number;
  budgetCuHours: number;
  usagePercent: number;
  consumptionPeriodStart: string | null;
  consumptionPeriodEnd: string | null;
}>;

const configuredBudgetCuHours = (): number => {
  const parsed = Number(ENV_VARS.NEON_COMPUTE_BUDGET_CU_HOURS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_BUDGET_CU_HOURS;
};

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

export const parseNeonProjectUsage = (
  payload: unknown,
  budgetCuHours: number
): NeonComputeQuotaResult => {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Neon control-plane returned invalid compute usage');
  }
  const typedPayload = payload as NeonProjectUsageResponse;
  const computeTimeSeconds = typedPayload.project?.compute_time_seconds;
  if (
    typeof computeTimeSeconds !== 'number' ||
    !Number.isFinite(computeTimeSeconds) ||
    computeTimeSeconds < 0
  ) {
    throw new Error('Neon control-plane returned invalid compute usage');
  }

  return classifyNeonComputeQuota({
    computeTimeSeconds,
    budgetCuHours,
    consumptionPeriodStart: optionalString(
      typedPayload.project?.consumption_period_start
    ),
    consumptionPeriodEnd: optionalString(
      typedPayload.project?.consumption_period_end
    ),
  });
};

export const classifyNeonComputeQuota = (params: {
  computeTimeSeconds: number;
  budgetCuHours: number;
  consumptionPeriodStart?: string | null;
  consumptionPeriodEnd?: string | null;
}): NeonComputeQuotaResult => {
  const usedCuHours = params.computeTimeSeconds / 3_600;
  const usagePercent = (usedCuHours / params.budgetCuHours) * 100;

  return {
    state: usagePercent >= CRITICAL_USAGE_PERCENT ? 'critical' : 'healthy',
    usedCuHours: Number(usedCuHours.toFixed(2)),
    budgetCuHours: params.budgetCuHours,
    // Preserve enough precision that the reported value cannot visually cross
    // the 85% alert boundary while the state is still healthy.
    usagePercent: Number(usagePercent.toFixed(2)),
    consumptionPeriodStart: params.consumptionPeriodStart ?? null,
    consumptionPeriodEnd: params.consumptionPeriodEnd ?? null,
  };
};

export const readNeonComputeQuota =
  async (): Promise<NeonComputeQuotaResult> => {
    const projectId = ENV_VARS.NEON_MONITORING_PROJECT_ID;
    const apiKey = ENV_VARS.NEON_MONITORING_API_KEY;
    if (!projectId || !apiKey) {
      throw new Error('Neon quota monitoring is not configured');
    }

    const response = await fetch(`${NEON_API_BASE}/projects/${projectId}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Neon control-plane returned HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    return parseNeonProjectUsage(payload, configuredBudgetCuHours());
  };

const sendHeartbeat = async (
  result: NeonComputeQuotaResult | null,
  failureMessage?: string
): Promise<void> => {
  const baseUrl = ENV_VARS.BETTERSTACK_NEON_QUOTA_HEARTBEAT_URL;
  if (!baseUrl) {
    return;
  }
  const failed = result == null || result.state === 'critical';
  const url = buildBetterStackHeartbeatUrl(baseUrl, failed);
  const body =
    result == null
      ? (failureMessage ?? 'Neon quota check failed')
      : JSON.stringify(result);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The heartbeat URL embeds a secret token. Never propagate fetch/URL error
    // text because runtimes may include the full request URL in diagnostics.
    throw new Error('Better Stack heartbeat request failed');
  }
  if (!response.ok) {
    throw new Error(`Better Stack heartbeat returned HTTP ${response.status}`);
  }
};

export const buildBetterStackHeartbeatUrl = (
  secretUrl: string,
  failed: boolean
): string => {
  let parsed: URL;
  try {
    parsed = new URL(secretUrl);
  } catch {
    throw new Error('Better Stack heartbeat URL is invalid');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Better Stack heartbeat URL must use HTTPS');
  }
  if (failed) {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/fail`;
  }
  return parsed.toString();
};

let checkInFlight = false;

export const runNeonComputeQuotaMonitorOnce = async (): Promise<void> => {
  if (checkInFlight) {
    return;
  }
  checkInFlight = true;
  try {
    const result = await readNeonComputeQuota();
    await sendHeartbeat(result);
    if (result.state === 'critical') {
      reportIssueBackend({
        mode: 'error',
        namespace: 'NEON_COMPUTE_QUOTA',
        message: `Neon compute usage reached ${result.usagePercent}%`,
        payload: result,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportIssueBackend({
      mode: 'error',
      namespace: 'NEON_COMPUTE_QUOTA',
      message,
      payload: {},
    });
    try {
      await sendHeartbeat(null, message);
    } catch (heartbeatError) {
      reportIssueBackend({
        mode: 'error',
        namespace: 'NEON_COMPUTE_QUOTA_HEARTBEAT',
        message:
          heartbeatError instanceof Error
            ? heartbeatError.message
            : String(heartbeatError),
        payload: {},
      });
    }
  } finally {
    checkInFlight = false;
  }
};

/**
 * Starts the control-plane quota check only when all three secrets/identifiers
 * are configured. It never imports Prisma or talks to Postgres, so the warm API
 * process cannot keep Neon compute awake through this monitor.
 */
export const startNeonComputeQuotaMonitor = (): (() => void) => {
  if (
    !ENV_VARS.NEON_MONITORING_API_KEY ||
    !ENV_VARS.NEON_MONITORING_PROJECT_ID ||
    !ENV_VARS.BETTERSTACK_NEON_QUOTA_HEARTBEAT_URL
  ) {
    return () => undefined;
  }

  void runNeonComputeQuotaMonitorOnce();
  const timer = setInterval(
    () => void runNeonComputeQuotaMonitorOnce(),
    CHECK_INTERVAL_MS
  );
  timer.unref?.();
  return () => clearInterval(timer);
};
