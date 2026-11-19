import type { RuntimeConfigValueType } from '../../domain/admin/runtime-config.config';

// Re-export RuntimeConfigValueType for consumers
export type { RuntimeConfigValueType } from '../../domain/admin/runtime-config.config';

export type RuntimeConfigEntry = {
  id: string;
  key: string;
  value: string;
  value_type: RuntimeConfigValueType;
  description: string | null;
  is_predefined: boolean;
  updated_at: string;
};
