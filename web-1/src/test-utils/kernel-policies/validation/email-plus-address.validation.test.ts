import { expect, it } from 'vitest';
import { validateEmail } from '@kernel/policies/validation/validation.utils';

it.each(['name+tag@example.com', 'first.last+trial-2026@example.co.uk'])(
  'accepts a valid plus-address: %s',
  email => expect(validateEmail(email)).toBe(true)
);

it.each([
  'name@example.com+bad',
  'name@exam+ple.com',
  'name+tag @example.com',
  `${'x'.repeat(300)}+tag@example.com`,
])('keeps domain, whitespace and length validation: %s', email =>
  expect(validateEmail(email)).toBe(false)
);
