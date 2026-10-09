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

  // DECISION (nie usuwaj tego komentarza):
  // De-seed reconcile: usuwa predefined klucze ktore ZNIKLY z kernel SSOT (np. po
  // retire/rename knoba — SESSION_TIMEOUT_MINUTES, MAX_LOGIN_ATTEMPTS,
  // PAIRING_SESSION_TTL_HOURS). createMany+skipDuplicates dodaje nowe, ale NIGDY nie
  // prune'uje — bez tego usuniete klucze zostaja jako edytowalne phantom-rowy w admin
  // UI (ryzyko: operator tuninguje martwy knob). Filtr is_predefined:true zachowuje
  // ewentualne admin-added ad-hoc. Idempotentne (po 1. boocie nic do skasowania).
  // Brak inbound-FK do runtime_configs -> delete bezpieczny.
  // SAFETY guard: Prisma notIn:[] = NOT IN () = match-WSZYSTKO -> gdyby
  // RUNTIME_CONFIG_KEYS kiedys stalo sie puste (dynamic refactor), bez guarda
  // skasowaloby WSZYSTKIE predefined rowy na boocie. Const = staly zestaw dzis
  // (impossible), ale operacja destrukcyjna => defense-in-depth.
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
