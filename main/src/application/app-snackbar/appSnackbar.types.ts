type SnackbarVariants = 'success' | 'info' | 'warning' | 'error';

export type SnackbarWrapper = {
  message: string;
  color: SnackbarVariants;
};
