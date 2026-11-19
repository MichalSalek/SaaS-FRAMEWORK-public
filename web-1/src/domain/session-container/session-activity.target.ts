/** Where the bell for a session activity lands: the conversation. */
export const sessionActivityTargetPath = (pairId: string): string =>
  `/app/messages/${pairId}`;
