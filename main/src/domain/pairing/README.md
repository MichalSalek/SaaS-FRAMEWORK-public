# Client and stylist pairing

**English** | [Polski](README.pl.md)

This area declares API calls for connecting clients with stylists, managing
requests and revoking access. A pairing is an access relationship, separate from
authentication and from the temporary QR session used to establish it.

## Flow

1. A stylist displays a QR code for a pairing session.
2. A signed-in client opens the claim flow and sends a request.
3. The stylist accepts or rejects the request.
4. An active relationship enables the operations allowed by the API's access rules.
5. Either the relevant account or an authorized operator can revoke access according
   to the backend's rules.

## Frontend responsibilities

`pairingIO.possibilities.api.ts` declares transport using kernel DTOs and routes.
Hooks in `UI/features/shared/pairing/hooks/` manage lists, requests and access state.
`UI/features/pairing/hooks/useQrScanner.ts` handles camera input and QR decoding.

Cache updates and messages belong to hooks and response feedback policies. Haptics
for confirmed server outcomes use the event pipeline. The API decides access even
when the client still has an older relationship in its cache.

## Reading guide

- [API declarations](pairingIO.possibilities.api.ts)
- [Shared pairing hooks](../../UI/features/shared/pairing/hooks/)
- [Pairing screen](../../UI/features/pairing/PairingPage.composition.tsx)
- [Domain declarations](../README.md)
