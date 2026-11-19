/**
 * User handlers bound through `defineEndpoint(contract)`.
 * Pins a command 400 and the confirmation-link token error.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import changeName from '../../pages/api/v1/user/change-name/index';
import deleteConfirm from '../../pages/api/v1/user/delete/confirm/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';

vi.mock('@domain/user/operations/user-query.operations', () => ({
  changeUserName_IO: vi.fn(),
}));

vi.mock('@domain/user/operations/user-mutations.operations', () => ({
  confirmDeleteSelf_IO: vi.fn(),
}));

describe('user through the API contract', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
  });

  it('change-name: a body without a name is 400 and never reaches the operation', async () => {
    const { changeUserName_IO } =
      await import('@domain/user/operations/user-query.operations');
    const { status, event, data } = await mockApiHandler<{ name?: string }>(
      changeName,
      { method: 'POST', body: {} }
    );
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(data.name).toContain('validation.name.');
    expect(changeUserName_IO).not.toHaveBeenCalled();
  });

  it('delete confirm: a missing token stays the token schema error', async () => {
    const { status, event, data } = await mockApiHandler<{ token?: string }>(
      deleteConfirm,
      { method: 'GET' }
    );
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(data.token).toContain('validation.token.required');
  });
});
