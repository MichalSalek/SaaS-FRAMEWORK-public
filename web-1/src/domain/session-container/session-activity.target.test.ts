import { describe, expect, it } from 'vitest';
import { sessionActivityTargetPath } from './session-activity.target';

describe('session activity notification target', () => {
  it('opens the conversation that holds the activity card', () => {
    expect(sessionActivityTargetPath('pair-1')).toBe('/app/messages/pair-1');
  });
});
