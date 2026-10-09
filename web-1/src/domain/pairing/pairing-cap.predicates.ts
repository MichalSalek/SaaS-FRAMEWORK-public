import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';

/**
 * DECISION (nie usuwaj tego komentarza) — CAPY LICZĄ KAŻDĄ PARĘ ACTIVE, TAKŻE
 * „DUCHA" (parę z kontrpartnerem po soft-delete albo po banie admina).
 *
 * Kuszące jest odfiltrowanie duchów, żeby „policzone" znaczyło „widoczne" — bo
 * ducha nie widać na liście i nie da się go z niej zwolnić. Ta wersja BYŁA tu
 * wdrożona i okazała się gorsza od problemu, który naprawiała: zwalnia slot,
 * podczas gdy wiersz ACTIVE dalej istnieje, więc gdy kontrpartner WRACA
 * (1-klikowe przywrócenie konta w oknie 90 dni albo odbanowanie), para wraca do
 * liczenia i konto jest TRWALE ponad limitem, a nic tego nie rekoncyliuje.
 *
 * Zmierzone na żywym backendzie: stylistka FREE (limit 2 par) miała 2 pary,
 * klientka skasowała konto, trzecia prośba została zaakceptowana, klientka
 * odzyskała konto — i konto FREE trzyma 3 pary bezterminowo. To samo powtarzalnie
 * dla kolejnych klientek, czyli bramka monetyzacji do obejścia z poziomu klienta.
 * Analogicznie dla platform-capu klientki i dla miejsc w salonie.
 *
 * Dlatego liczymy duchy: przekroczenie limitu jest niemożliwe z konstrukcji.
 * Koszt jest realny i ZNANY: duch zajmuje slot. DOMKNIĘTE decyzją właściciela
 * D1 (2026-09-05) wariantem (a): takie pary SĄ na listach (stylistki i klientki)
 * jako „Konto nieaktywne" z tożsamością zamaskowaną po stronie serwera
 * (getMyPairs_IO, pairing-query.operations.ts) i akcją „Zwolnij miejsce", która
 * idzie istniejącą ścieżką revoke-access (idempotentną). Wariant (b) —
 * rekoncyliacja przy przywracaniu konta — ŚWIADOMIE odrzucony: to ona produkowała
 * trwałe przekroczenie limitu. Slot zwalnia WYŁĄCZNIE jawna akcja albo terminalny
 * MOVE po 90 dniach (kaskada FK). Ten predykat pozostaje bez zmian.
 */
export const ACTIVE_PAIR_FOR_CAP = {
  status: PairingStatusValue.ACTIVE,
};
