import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { RUNTIME_CONFIG_KEYS } from '@kernel/domain/admin/runtime-config.config';

export const seedRuntimeConfigs = async (
  adminUserId: string
): Promise<void> => {
  const entries = Object.entries(RUNTIME_CONFIG_KEYS).map(([key, config]) => ({
    key,
    value: config.default,
    value_type: config.type,
    description: config.description,
    is_predefined: true,
    updated_by_user_id: adminUserId,
  }));

  await DB_CLIENT.use.runtimeConfig.createMany({
    data: entries,
    skipDuplicates: true,
  });

  // DECISION: de-seed reconcile. createMany + skipDuplicates adds new keys but never prunes, so
  // predefined keys retired from the kernel SSOT would linger as editable phantom rows in the admin
  // UI. Only is_predefined rows are removed (admin-added keys survive); runtime_configs has no
  // inbound FK. The length guard is mandatory: Prisma `notIn: []` matches EVERY row, so an empty
  // RUNTIME_CONFIG_KEYS would wipe all predefined rows on boot.
  const runtimeKernelKeys = Object.keys(RUNTIME_CONFIG_KEYS);
  if (runtimeKernelKeys.length > 0) {
    await DB_CLIENT.use.runtimeConfig.deleteMany({
      where: {
        is_predefined: true,
        key: { notIn: runtimeKernelKeys },
      },
    });
  }

  reportIssueBackend({
    mode: 'info',
    namespace: 'runtime-config-seed',
    message: `Runtime configs: ${entries.length} predefined keys seeded`,
    payload: {},
  });
};
