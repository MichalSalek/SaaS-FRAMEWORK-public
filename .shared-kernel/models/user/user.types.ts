import type { EffectivePlanFields } from '../../domain/pricing/effective-plan';
import type {
  ClientAccount,
  Session,
  StylistAccount,
  User,
} from '../db_models.generated.dto';
import type { UserRelationsAll } from '../db_models.manual.dto';

export type UserWithRelations = {
  stylist_account: (StylistAccount & EffectivePlanFields) | null;
  client_account: ClientAccount | null;
} & User;

export type UserWithRelationsExtended = Pick<
  UserRelationsAll,
  'stylist_account' | 'client_account'
> &
  User & {
    // Sessions come back as a Prisma _count to avoid N+1 over-fetching of session rows; last-login
    // info needs a separate query (getLastLogin() in UsersTable.parts.tsx).
    _count: { sessions: number };
  };

export type CurrentUser = UserWithRelations & Record<'session', Session>;
