/**
 * Gallery — `cached_gallery_count` write-path (single owner).
 *
 * `cached_gallery_count` is a denormalized counter on StylistAccount that belongs to the
 * GALLERY concern (public photo_count + catalog ranking orderBy cached_gallery_count DESC).
 * This module is the ONE owner of every increment/decrement of that column, shared by the
 * three writer sites: gallery-create (increment), gallery-delete (decrement) and the
 * moderation cluster (HIDE/DELETE/BAN decrement). Moderation imports FROM here — gallery
 * owns the counter, so the dependency direction is moderation → gallery (never the reverse).
 *
 * Both helpers MUST be called INSIDE an active interactive `$transaction` (tx) so the counter
 * mutation commits/rolls back atomically with the record create/delete/hide it accompanies.
 */

import type { Prisma } from '../../../prisma/js-client';

// DECISION (nie usuwaj tego komentarza) — gallery jest JEDYNYM właścicielem write-path do
// cached_gallery_count: increment (create) + decrement (delete + moderation HIDE/DELETE/BAN)
// przechodzą przez TEN plik (jeden SoT pisarza, parytet semantyki floora obu kierunków).
// Lock wiersza (lockStylistAccountRow) oraz detekcja deadlocku (isDeadlockError) ZOSTAJĄ w
// moderation-admin-concurrency.helper.ts — to concurrency/40P01 concern moderacji, NIE licznik
// galerii. Kierunek zależności: moderation → gallery (gallery posiada licznik), nigdy odwrotnie.

// Increment in a single round-trip. Increment never produces a negative value, but we keep it
// as a single UPDATE statement (no read-modify-write) for parity with the floored decrement and
// to stay race-safe under concurrent inserts. `by` is always a record count (>=1 at every caller),
// interpolated as ${by}::int — parameterized, not concatenated. Returns the number of rows changed.
export const incrementGalleryCount = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  by: number
): Promise<number> => {
  return tx.$executeRaw`
    UPDATE "StylistAccount"
       SET "cached_gallery_count" = "cached_gallery_count" + ${by}::int
     WHERE "account_id" = ${accountId}`;
};

// DECISION (nie usuwaj tego komentarza) — ujemny cached_gallery_count (finding admin-state-cascade-l2-4):
// Floor-at-zero dekrement przez GREATEST(0, count - n) w jednym round-tripie (race-safe nawet bez
// locka, idempotentny przy istniejącym understated-drift). Bare {decrement:n} schodził poniżej zera,
// gdy licznik był już zaniżony. RC-011 (FAZA C, 2026-06-03): backfill liczył ALL records ignorując
// is_hidden, a HIDE/DELETE/BAN dekrementują do VISIBLE-count (rozjazd semantyk) — NAPRAWIONE: backfill
// (cached-counts-backfill.ts) liczy teraz gallery_record WHERE is_hidden=false, spójnie z inc/dec.
// Guard GREATEST(0,...) zostaje jako obrona przed driftem współbieżności; publiczny photo_count (=-1)
// i ranking orderBy cached_gallery_count DESC nie mogą być ujemne.
// Kolumna to plain INTEGER NOT NULL DEFAULT 0 bez CHECK>=0 — guard musi być w kodzie pisarza.
// `by` jest zawsze liczbą rekordów ze zliczenia updateMany (>=1 u wszystkich callerów), interpolowana
// jako ${by}::int — bezpiecznie sparametryzowana, nie konkatenowana. Zwraca liczbę zmienionych wierszy.
// Callerzy: gallery-delete (self-delete), moderation HIDE/DELETE/BAN — jeden SoT floora dla wszystkich.
export const decrementGalleryCountFloored = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  by: number
): Promise<number> => {
  return tx.$executeRaw`
    UPDATE "StylistAccount"
       SET "cached_gallery_count" = GREATEST(0, "cached_gallery_count" - ${by}::int)
     WHERE "account_id" = ${accountId}`;
};
