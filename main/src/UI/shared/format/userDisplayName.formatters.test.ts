import { describe, expect, it } from 'vitest';
import {
  firstNonBlank,
  resolveUserDisplayName,
} from './userDisplayName.formatters';

describe('firstNonBlank', () => {
  it('skips null, undefined and whitespace-only values', () => {
    expect(firstNonBlank(null, undefined, '   ', ' Ala ')).toBe('Ala');
  });

  it('returns undefined when every value is blank', () => {
    expect(firstNonBlank('', null, ' ')).toBeUndefined();
  });
});

describe('resolveUserDisplayName', () => {
  it('prefers the stylist display name', () => {
    expect(
      resolveUserDisplayName({
        name: 'Alicja Nowak',
        email: 'ala@example.com',
        stylist_account: { display_name: 'Studio Ala' },
      })
    ).toBe('Studio Ala');
  });

  it('falls through an empty account name (User.name defaults to "")', () => {
    expect(
      resolveUserDisplayName({
        name: '',
        email: 'ala@example.com',
        stylist_account: { display_name: null },
      })
    ).toBe('ala@example.com');
  });

  it('returns undefined without a user', () => {
    expect(resolveUserDisplayName(undefined)).toBeUndefined();
  });
});
