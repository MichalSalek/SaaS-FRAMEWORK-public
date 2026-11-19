import { describe, expect, it } from 'vitest';
import {
  parsePlaygroundVotes,
  removeStoredPlaygroundVote,
  summarizePlaygroundVotes,
} from './playgroundVotes.storage';
import type { PlaygroundVote } from './playground.types';

const VOTES: readonly PlaygroundVote[] = [
  {
    id: 'v1',
    title: 'Panel',
    question: 'Który?',
    finding: 'Pomiar.',
    route: '/app/',
    widths: [390],
    candidates: [{ id: 'b', label: 'B: Krótko', rationale: 'Krócej.' }],
  },
];

describe('playground votes storage', () => {
  it('keeps valid choices, including DZIŚ', () => {
    expect(parsePlaygroundVotes('{"v1":"b"}', VOTES)).toEqual({ v1: 'b' });
    expect(parsePlaygroundVotes('{"v1":"today"}', VOTES)).toEqual({
      v1: 'today',
    });
  });

  it('drops closed votes, unknown candidates and junk', () => {
    expect(parsePlaygroundVotes('{"v0":"b","v1":"z"}', VOTES)).toEqual({});
    for (const raw of [null, 'x', '[]', '"s"', '{"v1":3}']) {
      expect(parsePlaygroundVotes(raw, VOTES)).toEqual({});
    }
  });

  it('summarizes with labels', () => {
    expect(summarizePlaygroundVotes({ v1: 'b' }, VOTES)).toBe(
      'v1 (Panel): B: Krótko'
    );
    expect(summarizePlaygroundVotes({}, VOTES)).toBe('');
  });
});

describe('closed palette vote reset', () => {
  it('removes only s125-paleta and preserves other stored votes', () => {
    const stored = JSON.stringify({
      's125-paleta': 's125-fuksja',
      v1: 'b',
      'future-vote': { choice: 'keep', metadata: 42 },
    });
    expect(
      JSON.parse(removeStoredPlaygroundVote(stored, 's125-paleta') ?? '{}')
    ).toEqual({ v1: 'b', 'future-vote': { choice: 'keep', metadata: 42 } });
  });

  it('leaves missing votes and invalid storage unchanged', () => {
    for (const raw of [null, 'x', '[]', '"s"', '{"v1":"b"}']) {
      expect(removeStoredPlaygroundVote(raw, 's125-paleta')).toBe(raw);
    }
  });
});
