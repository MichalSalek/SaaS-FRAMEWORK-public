import {
  AccountTypeValue,
  type AccountType,
} from '../../models/db_models.generated.dto';

// Re-export from db_models SSOT
export { AccountTypeValue, type AccountType };

// DECISION: ACCOUNT_ROLES is the only source of the role set; every helper (isValid, getOpposite) and
// consumer derives from this array, not from literals. The system is BINARY by design (STYLIST,
// CLIENT): getOppositeAccountType assumes |ACCOUNT_ROLES| == 2. A third role is a deliberate model
// change (Prisma enum, paired permission blocks, composites), not an array edit; do not generalise to N
// roles ahead of need (rule of three).
export const ACCOUNT_ROLES = Object.freeze([
  AccountTypeValue.STYLIST,
  AccountTypeValue.CLIENT,
] as const);

export const isValidAccountType = (value: unknown): value is AccountType =>
  typeof value === 'string' &&
  (ACCOUNT_ROLES as readonly string[]).includes(value);

// Derived from ACCOUNT_ROLES: for a 2-element array the "opposite" role is the one that
// is not the current one. The `?? accountType` fallback is unreachable for a valid role
// (|ACCOUNT_ROLES| == 2 is guaranteed by the DECISION above); it only satisfies the type.
export const getOppositeAccountType = (accountType: AccountType): AccountType =>
  ACCOUNT_ROLES.find(role => role !== accountType) ?? accountType;
