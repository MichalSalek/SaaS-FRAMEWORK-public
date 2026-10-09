import { describe, it, expect } from 'vitest';
import { parseAdditionalUserInputFromProviderProfile } from 'better-auth/db';

import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

import { USER_ADDITIONAL_FIELDS } from './user-fields.config';

// Kształt, jaki Better Auth podaje do parsera na ścieżce OAuth-signup:
// z profilu dostawcy zdjęte są już id/email/emailVerified/name/image, zostaje reszta.
const GOOGLE_PROFILE_REMAINDER = { locale: 'pl', given_name: 'Ala' };

const OPTIONS = {
  user: { additionalFields: USER_ADDITIONAL_FIELDS },
  plugins: [],
} as unknown as Parameters<
  typeof parseAdditionalUserInputFromProviderProfile
>[0];

describe('USER_ADDITIONAL_FIELDS na ścieżce rejestracji przez OAuth', () => {
  it('przechodzi walidację Better Auth mimo braku role_id w profilu dostawcy', () => {
    // Regresja produkcyjna 2026-08-20: `role_id` był `required: true` BEZ
    // `defaultValue`, a parser biblioteki odpala się PRZED hookiem
    // `user.create.before`, który rolę stempluje. Efekt: każda pierwsza próba
    // logowania Google kończyła się `?error=role_id_is_required` — wchodziły
    // wyłącznie konta już istniejące w bazie.
    expect(() =>
      parseAdditionalUserInputFromProviderProfile(
        OPTIONS,
        GOOGLE_PROFILE_REMAINDER,
        'create'
      )
    ).not.toThrow();
  });

  it('bezpiecznik nadaje najniższą rolę — podniesienie należy do hooka create.before', () => {
    const parsed = parseAdditionalUserInputFromProviderProfile(
      OPTIONS,
      GOOGLE_PROFILE_REMAINDER,
      'create'
    );
    expect(parsed).toMatchObject({ role_id: SystemRoleId.CLIENT_ROLE });
  });

  it('profil dostawcy nie może przemycić własnego role_id', () => {
    // `input: false` + `defaultValue` — wartość z zewnątrz jest odrzucana,
    // a nie honorowana (inaczej dostawca tożsamości nadawałby sobie rolę).
    const parsed = parseAdditionalUserInputFromProviderProfile(
      OPTIONS,
      { ...GOOGLE_PROFILE_REMAINDER, role_id: SystemRoleId.MASTER_ADMIN },
      'create'
    );
    expect(parsed).toMatchObject({ role_id: SystemRoleId.CLIENT_ROLE });
  });
});
