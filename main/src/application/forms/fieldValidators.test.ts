import { describe, it, expect } from 'vitest';
import {
  requiredFieldError,
  emailFieldError,
  minLengthFieldError,
  maxLengthFieldError,
} from './fieldValidators';

const REQ = 'required';
const INV = 'invalid';
const TOO_SHORT = 'too-short';
const TOO_LONG = 'too-long';

describe('requiredFieldError', () => {
  it('returns the message for empty / whitespace-only', () => {
    expect(requiredFieldError('', REQ)).toBe(REQ);
    expect(requiredFieldError('   ', REQ)).toBe(REQ);
  });
  it('passes for non-empty', () => {
    expect(requiredFieldError('Ada', REQ)).toBeUndefined();
  });
});

describe('emailFieldError', () => {
  const msgs = { required: REQ, invalid: INV };
  it('returns required for empty', () => {
    expect(emailFieldError('', msgs)).toBe(REQ);
    expect(emailFieldError('   ', msgs)).toBe(REQ);
  });
  it('returns invalid for a malformed address (kernel regex)', () => {
    expect(emailFieldError('not-an-email', msgs)).toBe(INV);
    expect(emailFieldError('a@b', msgs)).toBe(INV);
  });
  it('passes a well-formed address', () => {
    expect(emailFieldError('ada@example.com', msgs)).toBeUndefined();
    expect(emailFieldError('  ada@example.com  ', msgs)).toBeUndefined();
  });
});

describe('minLengthFieldError', () => {
  it('fails below the minimum (trimmed)', () => {
    expect(minLengthFieldError('hi', 10, TOO_SHORT)).toBe(TOO_SHORT);
    expect(minLengthFieldError('         ', 10, TOO_SHORT)).toBe(TOO_SHORT);
  });
  it('passes at or above the minimum', () => {
    expect(
      minLengthFieldError('a long enough message', 10, TOO_SHORT)
    ).toBeUndefined();
  });
});

describe('maxLengthFieldError', () => {
  it('fails above the maximum (trimmed)', () => {
    expect(maxLengthFieldError('abcdef', 3, TOO_LONG)).toBe(TOO_LONG);
  });
  it('passes at or below the maximum, and for empty', () => {
    expect(maxLengthFieldError('abc', 3, TOO_LONG)).toBeUndefined();
    expect(maxLengthFieldError('', 3, TOO_LONG)).toBeUndefined();
  });
});
