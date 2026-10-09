import type { PlaygroundVote } from './playground.types';
import { TODAY_CANDIDATE } from './playground.types';

export type PlaygroundVotes = Record<string, string>;

/** Drop choices for closed votes or candidates that no longer exist. */
export function parsePlaygroundVotes(
  serialized: string | null,
  votes: readonly PlaygroundVote[]
): PlaygroundVotes {
  try {
    const value: unknown = JSON.parse(serialized ?? '{}');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const result: PlaygroundVotes = {};
    for (const [voteId, choice] of Object.entries(value)) {
      const vote = votes.find(item => item.id === voteId);
      if (
        vote !== undefined &&
        typeof choice === 'string' &&
        (choice === TODAY_CANDIDATE.id ||
          vote.candidates.some(candidate => candidate.id === choice))
      ) {
        result[voteId] = choice;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Plain-text summary the owner pastes back into the conversation. */
export function summarizePlaygroundVotes(
  choices: PlaygroundVotes,
  votes: readonly PlaygroundVote[]
): string {
  return votes
    .filter(vote => choices[vote.id] !== undefined)
    .map(vote => {
      const choice = choices[vote.id];
      const label =
        choice === TODAY_CANDIDATE.id
          ? TODAY_CANDIDATE.label
          : (vote.candidates.find(candidate => candidate.id === choice)
              ?.label ?? choice);
      return `${vote.id} (${vote.title}): ${label}`;
    })
    .join('\n');
}

/** Remove only the requested stored vote, preserving all other entries. */
export function removeStoredPlaygroundVote(
  serialized: string | null,
  voteId: string
): string | null {
  try {
    const value: unknown = JSON.parse(serialized ?? '{}');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return serialized;
    }
    const entries = Object.entries(value);
    if (!entries.some(([key]) => key === voteId)) {
      return serialized;
    }
    return JSON.stringify(
      Object.fromEntries(entries.filter(([key]) => key !== voteId))
    );
  } catch {
    return serialized;
  }
}
