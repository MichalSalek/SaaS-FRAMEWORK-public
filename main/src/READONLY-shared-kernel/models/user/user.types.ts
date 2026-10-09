import type {
  ClientAccount,
  Session,
  StylistAccount,
  User,
} from '../db_models.generated.dto';
import type { UserRelationsAll } from '../db_models.manual.dto';

export type UserWithRelations = {
  stylist_account: StylistAccount | null;
  client_account: ClientAccount | null;
} & User;

export type UserWithRelationsExtended = Pick<
  UserRelationsAll,
  'stylist_account' | 'client_account'
> &
  User & {
    // DECISION (nie usuwaj tego komentarza):
    // Sessions returned as Prisma _count to avoid N+1 over-fetching of session rows.
    // Last-login info wymaga osobnego query — patrz getLastLogin() w UsersTable.parts.tsx.
    _count: { sessions: number };
  };

export type CurrentUser = UserWithRelations & Record<'session', Session>;
