// Fixture standalone (bez importow): probki sa kopiowane do mini-projektu
// selftestu, a tsconfig testow i tak kompiluje ten katalog.
//
// This file mentions MENTIONED_IN_COMMENT_ONLY only in prose — it is not a
// real APP_EVENTS member expression anywhere, so the AST scan never sees it
// as a read. Real TypeScript comments are trivia, invisible to the AST by
// construction; this sample proves the guard does not fall back to a
// same-line text scan that WOULD have caught it (see the .expect-not).
// See MENTIONED_IN_COMMENT_ONLY for context on the old, retired signal.
declare const DB_CLIENT: {
  use: { eventLog: { findFirst: (a: unknown) => Promise<unknown> } };
};
declare const recordAuditEvent_IO: (a: unknown) => Promise<unknown>;
declare const APP_EVENTS: {
  INFO: { EMAIL: { EMAIL_WELCOME_SENT: 'EMAIL_WELCOME_SENT' } };
};

export const writeWelcome_IO = async () =>
  recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.EMAIL.EMAIL_WELCOME_SENT,
  });

export const alreadySentWelcome_IO = async () =>
  DB_CLIENT.use.eventLog.findFirst({
    where: { event: APP_EVENTS.INFO.EMAIL.EMAIL_WELCOME_SENT },
  });
