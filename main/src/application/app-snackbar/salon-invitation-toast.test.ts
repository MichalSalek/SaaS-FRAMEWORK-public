import { beforeEach, describe, expect, it } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { pushNewSnackbar } from './appSnackbar.possibilities.api';
import { useSnackbarStore } from './appSnackbar.store';

describe('salon invitation feedback', () => {
  beforeEach(() => useSnackbarStore.setState({ snackbars: [] }));
  it('keeps the informative local toast when API also dispatches invitation success', () => {
    pushNewSnackbar(APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITED);
    pushNewSnackbar(
      'Invitation sent. The invited person can accept from their email.',
      'success'
    );
    expect(useSnackbarStore.getState().snackbars).toEqual([
      {
        message:
          'Invitation sent. The invited person can accept from their email.',
        color: 'success',
      },
    ]);
  });
  it('keeps one local toast when leaving or removing a team member', () => {
    pushNewSnackbar(APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_REMOVED);
    pushNewSnackbar('Team membership ended.', 'success');
    expect(useSnackbarStore.getState().snackbars).toEqual([
      { message: 'Team membership ended.', color: 'success' },
    ]);
  });
});
