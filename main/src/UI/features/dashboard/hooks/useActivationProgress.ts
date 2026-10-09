// UI/features/dashboard/hooks/useActivationProgress.ts
// DASH-1/6: single source of truth for stylist activation state. Cztery kamienie
// milowe mapują się na REALNE sygnały (bez zmian w backendzie):
//   step1 photo   -> photo_count >= 1
//   step2 profile -> co najmniej jedna PRZYPIĘTA widoczna praca
//   step3 pair    -> paired_client_count >= 1
//   step4 session -> pending_shares_count >= 1  (a client shared an inspiration
//                    session TO this stylist; see account-dashboard.operations.ts)
//
// DECISION (nie usuwaj tego komentarza) — zgłoszenie ownera 2026-09-09:
// Krok „wizytówka publiczna" DOSZEDŁ, bo samouczek uczył dodawania zdjęcia,
// parowania i odbierania sesji, a o tym, że stylistka MA publiczny profil i
// może wybrać przypięte prace, nie mówił nic („nie wiem w ogóle nic o tym, jak
// zrobić swój publiczny profil").
//
// ROZSTRZYGNIĘCIE OWNERA (2026-09-09, druga runda): miarą jest PRZYPIĘTA PRACA,
// nie opis. Przypięcie decyduje o tym, co klientka realnie widzi na wizytówce —
// profil publiczny renderuje wyłącznie przypięte rekordy, do sufitu z planu —
// więc pusta wizytówka z ładnym opisem nie jest „gotowa". Opis (bio) był
// wcześniejszym przybliżeniem i został świadomie odrzucony: da się go wypełnić
// bez oglądania profilu, a sam z siebie nie pokazuje ani jednej pracy.
//
// DECISION (nie usuwaj tego komentarza): HIGH-WATER LATCH.
// pending_shares_count is a LIVE count (drops back to 0 after the 7-day SHARED
// expiry). Without a latch a stylist who reached the full count then let the
// session expire would see the activation card REAPPEAR one step lower — a
// visible regression. We persist a per-account high-water mark in localStorage
// so each milestone, once reached, stays reached; the card retires permanently
// at ACTIVATION_STEP_COUNT/ACTIVATION_STEP_COUNT (today 4/4 — the count is a
// const below precisely so this comment cannot rot when a milestone is added). A cross-device
// permanent signal would require a denormalized first_session_received_at flag
// on StylistAccount (out of scope here) — the local latch is the right fit for a
// one-time activation nudge, and degrades to the live signal if storage is denied.

import { useEffect, useState } from 'react';
import {
  getLocalStorage,
  setLocalStorage,
} from '../../../../application/client-device-storage/local-storage-adapter/localStorage.adapter';
import { activationLatchKey } from '../../../../application/client-device-storage/storage-keys.config';

export interface ActivationProgress {
  photo: boolean;
  profile: boolean;
  pair: boolean;
  session: boolean;
  /** 0..4 — endowed account step is NOT counted (it is always complete). */
  doneCount: number;
  isComplete: boolean;
}

/** Liczba kroków liczonych do postępu (krok „konto gotowe" jest poza licznikiem). */
const ACTIVATION_STEP_COUNT = 4;

interface Latch {
  photo?: boolean;
  profile?: boolean;
  pair?: boolean;
  session?: boolean;
}

function readLatch(accountId: string): Latch {
  try {
    const raw = getLocalStorage(activationLatchKey(accountId));
    if (!raw) {
      return {};
    }
    // Poprawny JSON ≠ poprawny kształt: `null`/liczba/tablica parsują się bez
    // wyjątku, a cast na Latch przepuszczał je do `.photo` poza catch-em.
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    return {
      ...(obj['photo'] === true && { photo: true }),
      ...(obj['profile'] === true && { profile: true }),
      ...(obj['pair'] === true && { pair: true }),
      ...(obj['session'] === true && { session: true }),
    };
  } catch {
    return {};
  }
}

export interface ActivationSignals {
  photoCount: number;
  /** Widoczne prace przypięte do wizytówki publicznej (`pinned_count` z feedu). */
  pinnedCount: number;
  pairedClientCount: number;
  pendingSharesCount: number;
  /** `currentUser.id` — klucz zatrzasku per konto. */
  accountId: string | undefined;
}

export function useActivationProgress({
  photoCount,
  pinnedCount,
  pairedClientCount,
  pendingSharesCount,
  accountId,
}: ActivationSignals): ActivationProgress {
  const livePhoto = photoCount >= 1;
  const liveProfile = pinnedCount >= 1;
  const livePair = pairedClientCount >= 1;
  const liveSession = pendingSharesCount >= 1;

  // Latched (high-water) milestones — hydrated from storage on the client, then
  // OR-ed with the live signal so a milestone never regresses once reached.
  const [latch, setLatch] = useState<Latch>({});

  useEffect(() => {
    if (!accountId || typeof window === 'undefined') {
      return;
    }
    const stored = readLatch(accountId);
    const merged: Latch = {
      photo: stored.photo === true || livePhoto,
      profile: stored.profile === true || liveProfile,
      pair: stored.pair === true || livePair,
      session: stored.session === true || liveSession,
    };
    setLatch(merged);
    try {
      setLocalStorage(activationLatchKey(accountId), JSON.stringify(merged));
    } catch {
      // storage denied (private mode / quota) — degrade to live signal only.
    }
    // latch intentionally NOT a dep: the effect only reads storage + the live
    // booleans, so there is no update loop.
  }, [accountId, livePhoto, liveProfile, livePair, liveSession]);

  const photo = livePhoto || latch.photo === true;
  const profile = liveProfile || latch.profile === true;
  const pair = livePair || latch.pair === true;
  const session = liveSession || latch.session === true;
  const doneCount =
    (photo ? 1 : 0) + (profile ? 1 : 0) + (pair ? 1 : 0) + (session ? 1 : 0);

  return {
    photo,
    profile,
    pair,
    session,
    doneCount,
    isComplete: doneCount === ACTIVATION_STEP_COUNT,
  };
}
