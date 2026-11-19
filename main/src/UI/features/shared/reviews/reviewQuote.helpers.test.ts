import { describe, expect, it } from 'vitest';
import { splitLastSentence } from './reviewQuote.helpers';

describe('splitLastSentence', () => {
  it('returns the closing sentence and what stands before it', () => {
    expect(
      splitLastSentence(
        'Moje ulubione? Mądre filtry. Konsultacje skróciły się o połowę.'
      )
    ).toEqual({
      lead: 'Moje ulubione? Mądre filtry.',
      last: 'Konsultacje skróciły się o połowę.',
    });
  });

  it('keeps a one-sentence quote whole', () => {
    expect(splitLastSentence('Polecam każdej stylistce.')).toEqual({
      lead: '',
      last: 'Polecam każdej stylistce.',
    });
  });

  it('does not split on a mark that is not followed by a space', () => {
    expect(splitLastSentence('Wersja 2.0 działa. Jest szybciej!')).toEqual({
      lead: 'Wersja 2.0 działa.',
      last: 'Jest szybciej!',
    });
  });
});
