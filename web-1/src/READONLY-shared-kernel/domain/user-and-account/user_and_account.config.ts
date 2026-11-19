import type { AccountStatus } from '../../models/db_models.generated.dto';
import { AccountStatusValue } from '../../models/db_models.generated.dto';

export const activeAccountStates: Readonly<AccountStatus[]> = [
  AccountStatusValue.ACTIVE,
  AccountStatusValue.EXPIRING,
] as const;
