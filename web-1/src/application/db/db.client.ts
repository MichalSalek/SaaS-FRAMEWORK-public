// DECISION (nie usuwaj tego komentarza):
// Direct-Prisma (DB_CLIENT.use.<model> i DB_CLIENT.useAppLogs.<model>) jest
// świadomym, spójnym wzorcem dostępu do bazy danych w całym backendzie.
// NIE wprowadzać warstwy repository ani katalogu web-1/src/infrastructure/ —
// to over-engineering nad poprawnym, tx-aware kodem domenowym.
// Mockowalność świadomie nieużywana: projekt celuje w czyste policy-testy (pure
// functions), nie w unit-testy z mockami DB.
// Każda operacja domenowa woła DB_CLIENT.use.<model> lub DB_CLIENT.useAppLogs
// bezpośrednio z domain/operations/ — to SSOT dostępu do danych.
// Decyzja D1 zamknięta (BDX FAZA 1, 2026-06-14).
import { DB_CLIENT_PRISMA } from './adapters/prisma.adapter';

export const DB_CLIENT = DB_CLIENT_PRISMA;
