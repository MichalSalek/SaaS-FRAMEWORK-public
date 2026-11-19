import type {
  RuntimeConfigKey,
  RuntimeConfigValueType,
} from '../admin/runtime-config.config';

export const RUNTIME_FEATURE_CATEGORIES = [
  'Email',
  'Operations',
  'Diagnostics',
  'OtherControls',
] as const;
type RuntimeFeatureCategory = (typeof RUNTIME_FEATURE_CATEGORIES)[number];

/** UI placement only; existing runtime records and defaults remain authoritative. */
const RUNTIME_FEATURE_CONTROLS = {
  FREE_EMAIL_MODE: 'Email',
  MAINTENANCE_MODE: 'Operations',
  VERBOSE_LOG_MODE: 'Diagnostics',
  API_TIMING_DEBUG_MODE: 'Diagnostics',
} as const satisfies Partial<Record<RuntimeConfigKey, RuntimeFeatureCategory>>;

export function runtimeFeatureCategory(
  key: string,
  valueType?: RuntimeConfigValueType
): RuntimeFeatureCategory | null {
  return (
    Object.entries(RUNTIME_FEATURE_CONTROLS).find(
      ([candidate]) => candidate === key
    )?.[1] ?? (valueType === 'boolean' ? 'OtherControls' : null)
  );
}
