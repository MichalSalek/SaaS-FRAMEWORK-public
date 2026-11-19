// Lightweight Zustand store that buffers snackbar requests pushed from anywhere
// in the app (IO callbacks, side-effect interceptors). `AppSnackbarsController`
// subscribes to the head of the queue and forwards it to Sonner's `toast()`
// after running the i18n translation pass for event-name keys.

import { create } from 'zustand';
import type { SnackbarWrapper } from './appSnackbar.types';

interface SnackbarState {
  /** FIFO queue of pending snackbar requests. Controller pops from index 0. */
  snackbars: SnackbarWrapper[];
  push: (snackbar: SnackbarWrapper) => void;
  /** Drop the head — called by the controller after a toast is dispatched. */
  shift: () => void;
}

export const useSnackbarStore = create<SnackbarState>(set => ({
  snackbars: [],
  push: snackbar =>
    set(state => ({ snackbars: [...state.snackbars, snackbar] })),
  shift: () =>
    set(state => ({
      snackbars: state.snackbars.length > 0 ? state.snackbars.slice(1) : [],
    })),
}));
