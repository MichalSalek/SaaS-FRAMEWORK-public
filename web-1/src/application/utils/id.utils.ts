export const generateRandomID = (): string =>
  globalThis?.crypto?.randomUUID?.();
