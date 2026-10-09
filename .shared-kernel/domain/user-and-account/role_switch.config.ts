import {
  AccountTypeValue,
  type AccountType,
} from '../../models/db_models.generated.dto';

// Re-export from db_models SSOT
export { AccountTypeValue, type AccountType };

// DECISION (nie usuwaj tego komentarza):
// ACCOUNT_ROLES jest JEDYNYM źródłem zbioru ról — wszystkie helpery (isValid,
// getOpposite) i konsumenci derywują się z tej tablicy, nie z literałów.
// System jest BINARNY Z ZAŁOŻENIA (2 role: STYLIST, CLIENT). getOppositeAccountType
// zakłada |ACCOUNT_ROLES| == 2 (zwraca "tę drugą"). 3. rola = ŚWIADOMA decyzja
// (Tier 3 / fork), nie przypadek — wymagałaby zmiany MODELU ról (Prisma enum,
// parowane bloki permissions, composity), nie samej tej tablicy. Nie generalizuj
// do N ról "na zapas" (rule-of-three: 3. roli nie ma). FWE Wave B.
export const ACCOUNT_ROLES = Object.freeze([
  AccountTypeValue.STYLIST,
  AccountTypeValue.CLIENT,
] as const);

export const isValidAccountType = (value: unknown): value is AccountType =>
  typeof value === 'string' &&
  (ACCOUNT_ROLES as readonly string[]).includes(value);

// Derywowane z ACCOUNT_ROLES: dla tablicy 2-elementowej "przeciwna" rola to ta,
// która nie jest bieżącą. Fallback `?? accountType` nieosiągalny dla prawidłowej
// roli (gwarancja |ACCOUNT_ROLES| == 2 z DECISION powyżej) — satysfakcjonuje typ.
export const getOppositeAccountType = (accountType: AccountType): AccountType =>
  ACCOUNT_ROLES.find(role => role !== accountType) ?? accountType;
