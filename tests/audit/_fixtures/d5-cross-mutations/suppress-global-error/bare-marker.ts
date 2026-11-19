// suppress-global-error-allow:
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
