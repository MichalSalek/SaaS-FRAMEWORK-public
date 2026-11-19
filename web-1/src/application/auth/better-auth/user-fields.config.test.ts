import { describe, it, expect } from 'vitest';
import { parseAdditionalUserInputFromProviderProfile } from 'better-auth/db';

import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

import { USER_ADDITIONAL_FIELDS } from './user-fields.config';

// The shape Better Auth passes to the parser on the OAuth sign-up path: id/email/
// emailVerified/name/image are already stripped from the provider profile, the rest remains.
const GOOGLE_PROFILE_REMAINDER = { locale: 'pl', given_name: 'Ala' };

const OPTIONS = {
  user: { additionalFields: USER_ADDITIONAL_FIELDS },
  plugins: [],
} as unknown as Parameters<
  typeof parseAdditionalUserInputFromProviderProfile
>[0];

describe('USER_ADDITIONAL_FIELDS na ścieżce rejestracji przez OAuth', () => {
  it('przechodzi walidację Better Auth mimo braku role_id w profilu dostawcy', () => {
    // Production regression: `role_id` was `required: true` WITHOUT a `defaultValue`,
    // and the library parser runs BEFORE the `user.create.before` hook that stamps the
    // role. Every first Google sign-in ended in `?error=role_id_is_required`; only
    // accounts already in the database could log in.
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
