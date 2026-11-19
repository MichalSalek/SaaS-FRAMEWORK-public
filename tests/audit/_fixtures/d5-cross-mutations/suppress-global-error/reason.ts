// suppress-global-error-allow: page snackbar, the hook carries the meta
export function pushNewSnackbar(message: string): string {
  return message;
}
export function useMutation(options: { onError?: () => void }): { mutate: () => void } {
  return { mutate() { options.onError?.(); } };
}
export function useBad(): { mutate: () => void } {
  return useMutation({
    onError: () => {
      pushNewSnackbar('failed');
    },
  });
}
