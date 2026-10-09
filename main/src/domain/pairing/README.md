# Pairing Domain

Warstwa domenowa połączeń stylist↔klientka (stały kod QR, model z 2026-07-12).

## Model: stały kod

Generowane 15-min kody sesyjne (issue/claim/revoke tokenów) **usunięto** razem z UI
generowania. Aktualny flow:

1. Stylistka ma **stały kod QR** (plakat przy stanowisku / ekran) → prowadzi na jej
   publiczny profil.
2. Klientka skanuje aparatem telefonu, ląduje na profilu i **wysyła prośbę o połączenie**
   (`pairRequestCreate`, client-only). Dopóki prośba jest `PENDING`, może ją **anulować**
   (`pairRequestCancel`).
3. Stylistka **akceptuje/odrzuca** prośbę 1 tapem na ekranie Parowanie
   (`pairRequestRespond`) → powstaje `ACTIVE` para.
4. Rozłączenie: `pairingRevokeAccess` (klientka, przez modal limitu).

Backendowe endpointy sesyjne zostają jako legacy (nieeksponowane; ewentualne wycięcie
osobną decyzją po becie).

## Struktura (rzeczywista — 3 pliki)

```
domain/pairing/
├── pairingIO.possibilities.api.ts  # promise-first front-door (defineEndpoint/defineQuery)
├── pairing.types.ts                # PairedItem union + type-guardy (isPairedStylist/isPairedClient)
└── README.md
```

## IO (`pairingIO.possibilities.api.ts`)

| Funkcja | Kierunek | Użycie |
|---|---|---|
| `pairRequestCreate` | klientka → | prośba o połączenie z publicznego profilu |
| `pairRequestRespond` | stylistka → | accept/decline prośby |
| `pairRequestCancel` | klientka → | anulowanie własnej prośby `PENDING` (zanim stylistka odpowie) |
| `pairingGetPendingRequests` | stylistka ← | lista próśb PENDING |
| `pairingGetMyPairs` | ← | lista par (cursor pagination) |
| `pairingGetAccessStatus` | ← | realny stan pary (token-gated) |
| `pairingRevokeAccess` | klientka → | rozłączenie |

## Hooki (żyją w `UI/features/**`, nie w domenie)

- `UI/features/shared/pairing/hooks/` — `usePairedList` (SSOT fetch par + `pairs`/`isLoading`/`isError`),
  `usePairedStylists` (widok klientki), `usePairRequests` (create/respond/pending),
  `usePairingAccessStatus`.
- `UI/features/pairing/hooks/` — `useUnpair` (dane kontaktowe klientki są na jej karcie, nie w wierszu parowania; S122).

## Typy (`pairing.types.ts`)

`PairedItem` = union `PairedStylist | PairedClient`; zawężaj **wyłącznie** przez
`isPairedStylist` / `isPairedClient` (SSOT dyskryminantu — nie inline'uj `'account_id' in x`).
