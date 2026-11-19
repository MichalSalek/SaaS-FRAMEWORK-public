// DECISION: direct Prisma (DB_CLIENT.use.<model> and DB_CLIENT.useAppLogs.<model>) is the
// deliberate, consistent DB access pattern across the backend. Do NOT introduce a repository layer
// or a web-1/src/infrastructure/ directory: that is over-engineering on top of correct, tx-aware
// domain code. Mockability is deliberately unused (the project targets pure policy tests, not
// DB-mock unit tests). Every domain operation calls DB_CLIENT directly from domain/operations/.
import { DB_CLIENT_PRISMA } from './adapters/prisma.adapter';

export const DB_CLIENT = DB_CLIENT_PRISMA;
