import { describe, it, expect } from 'vitest';
import { SUPPORT_LENGTHS } from '@kernel/policies/validation.config';
import { deriveSupportSubject } from './support-subject.resolver';

describe('deriveSupportSubject', () => {
  it('takes the first line of the trimmed message', () => {
    expect(
      deriveSupportSubject('\n  Nie mogę dodać zdjęcia  \nSzczegóły niżej.')
    ).toBe('Nie mogę dodać zdjęcia');
  });

  it('collapses whitespace inside the line', () => {
    expect(deriveSupportSubject('Płatność \t  nie   przeszła\ndalej')).toBe(
      'Płatność nie przeszła'
    );
  });

  it('handles CRLF line ends', () => {
    expect(deriveSupportSubject('Pierwsza linia\r\nDruga linia')).toBe(
      'Pierwsza linia'
    );
  });

  it('falls back to the whole collapsed message when the first line is too short', () => {
    expect(deriveSupportSubject('Hi\n\nmy payment did not go through')).toBe(
      'Hi my payment did not go through'
    );
  });

  it('cuts to SUBJECT_MAX', () => {
    const subject = deriveSupportSubject('a'.repeat(500));
    expect(subject).toHaveLength(SUPPORT_LENGTHS.SUBJECT_MAX);
  });

  it('does not end on half of a surrogate pair', () => {
    const message = `${'a'.repeat(SUPPORT_LENGTHS.SUBJECT_MAX - 1)}💅 reszta`;
    const subject = deriveSupportSubject(message);
    expect(subject).toBe('a'.repeat(SUPPORT_LENGTHS.SUBJECT_MAX - 1));
  });

  it('never returns less than SUBJECT_MIN for the shortest valid message', () => {
    // MESSAGE_MIN trimmed characters with the widest possible whitespace run.
    const message = `a${' '.repeat(SUPPORT_LENGTHS.MESSAGE_MIN - 2)}b`;
    expect(deriveSupportSubject(message).length).toBeGreaterThanOrEqual(
      SUPPORT_LENGTHS.SUBJECT_MIN
    );
  });
});
