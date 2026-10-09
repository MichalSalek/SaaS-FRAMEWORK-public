// Fixture standalone (bez importow): probki sa kopiowane do mini-projektu
// selftestu, a tsconfig testow i tak kompiluje ten katalog.
declare const DB_CLIENT: {
  use: { eventLog: { findMany: (a: unknown) => Promise<unknown> } };
};
declare const APP_EVENTS: {
  INFO: { ACCOUNT: { ACCOUNT_CREATED: 'ACCOUNT_CREATED' } };
};

// Mirrors the 2026-09-23 incident: a signup digest read ACCOUNT_CREATED, but
// nothing anywhere writes it — the digest could never fire.
export const sendDailySignupDigest_IO = async () =>
  DB_CLIENT.use.eventLog.findMany({
    where: {
      event: APP_EVENTS.INFO.ACCOUNT.ACCOUNT_CREATED,
    },
  });
