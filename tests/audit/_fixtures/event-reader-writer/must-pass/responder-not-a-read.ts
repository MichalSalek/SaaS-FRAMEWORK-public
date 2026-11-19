// Fixture standalone (bez importow): probki sa kopiowane do mini-projektu
// selftestu, a tsconfig testow i tak kompiluje ten katalog.
//
// A response envelope naming an event that NOBODY writes must NOT be treated
// as an EventLog read — it never touches the eventLog table at all. The
// legitimate read+writer pair below only exists to satisfy the presence
// floor (this sample must contain at least one real where.event site so the
// guard proves it actually scanned something).
declare const DB_CLIENT: {
  use: { eventLog: { findFirst: (a: unknown) => Promise<unknown> } };
};
declare const recordAuditEvent_IO: (a: unknown) => Promise<unknown>;
declare const respondSuccess: (res: unknown, data: unknown, event: unknown) => void;
declare const APP_EVENTS: {
  INFO: {
    EMAIL: { EMAIL_WELCOME_SENT: 'EMAIL_WELCOME_SENT' };
    APPLICATION: { NEVER_WRITTEN_RESPONSE_EVENT: 'NEVER_WRITTEN_RESPONSE_EVENT' };
  };
};

export const respondOnly = (res: unknown, data: unknown) =>
  respondSuccess(res, data, APP_EVENTS.INFO.APPLICATION.NEVER_WRITTEN_RESPONSE_EVENT);

export const writeWelcome_IO = async () =>
  recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.EMAIL.EMAIL_WELCOME_SENT,
  });

export const alreadySentWelcome_IO = async () =>
  DB_CLIENT.use.eventLog.findFirst({
    where: { event: APP_EVENTS.INFO.EMAIL.EMAIL_WELCOME_SENT },
  });
