export function pushNewSnackbar(message: string): string {
  return message;
}
export function useMutation(options: { onError?: () => void }): { mutate: () => void } {
  return { mutate() { options.onError?.(); } };
}
export const lie = 'suppressGlobalError: true';
export function useBad(): { mutate: () => void } {
  return useMutation({
    onError: () => {
      pushNewSnackbar('failed');
    },
  });
}
