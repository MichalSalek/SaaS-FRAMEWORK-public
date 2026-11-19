// Fixture standalone (bez importow): probki sa kopiowane do mini-projektu
// selftestu, a tsconfig testow i tak kompiluje ten katalog.
//
// event-reader-writer-allow:
//
// The marker above has NO reason after the colon — it must fail on its own,
// even though the read below is perfectly alive (has a matching writer).
declare const DB_CLIENT: {
  use: { eventLog: { findFirst: (a: unknown) => Promise<unknown> } };
};
declare const recordAuditEvent_IO: (a: unknown) => Promise<unknown>;
declare const APP_EVENTS: {
  INFO: { ACCOUNT: { SOMETHING_HAPPENED: 'SOMETHING_HAPPENED' } };
};

export const writeIt_IO = async () =>
  recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.ACCOUNT.SOMETHING_HAPPENED,
  });

export const readIt_IO = async () =>
  DB_CLIENT.use.eventLog.findFirst({
    where: { event: APP_EVENTS.INFO.ACCOUNT.SOMETHING_HAPPENED },
  });
