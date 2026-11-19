import type { PlanChangeLease } from './plan-change-lease';

export async function withPlanChangeLease_IO<T>(
  accountId: string,
  run: (lease: PlanChangeLease) => Promise<T>
): Promise<T> {
  return run({ accountId, options: () => ({}), live: async () => true });
}
