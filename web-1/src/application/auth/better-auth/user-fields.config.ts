// web-1/src/application/auth/better-auth/user-fields.config.ts
//
// Kolumny tabeli `users`, o których Better Auth musi wiedzieć poza swoim rdzeniem.
// Wydzielone z better-auth.config.ts, żeby dało się je odpalić w teście bez
// budowania całej instancji `auth` (env, klient bazy, podpisywanie JWT Apple).

import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';

/**
 * DECISION (nie usuwaj tego komentarza):
 * `defaultValue` przy `role_id` NIE jest ozdobnikiem — bez niego rejestracja przez
 * OAuth (Google/Apple) wywala się, zanim cokolwiek dojdzie do bazy.
 *
 * Better Auth 1.6.x na ścieżce OAuth-signup woła
 * `parseAdditionalUserInputFromProviderProfile(options, providerProfile, 'create')`
 * (dist/oauth2/link-account.mjs) JESZCZE PRZED `createOAuthUser`, a więc przed hookiem
 * `databaseHooks.user.create.before`, który rolę stempluje. `parseInputData` sprawdza
 * pola w kolejności: `defaultValue` → dopiero potem `required`. Profil od Google nigdy
 * nie niesie `role_id`, więc pole bez wartości domyślnej leci
 * `APIError('role_id is required')`; `callbackOAuth` zamienia spacje na podkreślniki
 * i odsyła użytkownika na front z `?error=role_id_is_required`.
 *
 * Incydent produkcyjny 2026-08-20: logowały się WYŁĄCZNIE konta już istniejące w bazie
 * (m.in. administratora), bo one omijają gałąź tworzenia użytkownika. Magic-link był
 * odporny — `internalAdapter.createUser` tej walidacji nie przechodzi.
 *
 * Wartość domyślna to CELOWO najniższa rola (CLIENT_ROLE) i pełni funkcję bezpiecznika:
 * faktyczną rolę nadaje hook `user.create.before` (admin allow-list → MASTER_ADMIN),
 * który wykonuje się później i nadpisuje to pole na każdej ścieżce rejestracji.
 *
 * `required: true` ZOSTAJE — trzyma `role_id` jako nie-opcjonalne w typach sesji
 * (`InferFieldsOutput`: `required: false` dokleiłoby `| undefined | null`).
 */
export const USER_ADDITIONAL_FIELDS = {
  role_id: {
    type: 'string',
    required: true,
    input: false,
    defaultValue: SystemRoleId.CLIENT_ROLE,
  },
  account_type: {
    type: 'string',
    required: false,
    defaultValue: AccountTypeValue.CLIENT,
    input: false,
  },
  is_active: {
    type: 'boolean',
    required: false,
    defaultValue: true,
    input: false,
  },
  moderation_strikes: {
    type: 'number',
    required: false,
    defaultValue: 0,
    input: false,
  },
  notifications_enabled: {
    type: 'boolean',
    required: false,
    defaultValue: true,
    input: false,
  },
} as const;
