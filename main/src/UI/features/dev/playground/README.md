# /dev/playground — owner-vote workshop

Dev and staging only (`ARE_DEV_ROUTES_ENABLED`), noindex. The shell stays between votes;
only vote entries and their variant branches come and go.

## How it works

- Every candidate is the **live product route** in a same-origin iframe at a real CSS width.
  DZIŚ is the route as it is; a candidate is the same route with `?pg=<voteId>:<candidateId>`.
  Same session, same data, same locale, real media queries and sticky bars.
- The product component reads the parameter through
  `usePlaygroundVariant(voteId)` (`UI/shared/hooks/usePlaygroundVariant.ts`), which is
  always `null` in production. Pure parsing lives in `application/playground/playground-variant.ts`.
- Framing is allowed only on dev and staging, only same-origin, and only `/dev/playground`
  may frame (`application/security/playground-frame.policy.ts`, wired in `proxy.ts`).
  `next.config.mjs` sends `X-Frame-Options: SAMEORIGIN` on dev and staging, `DENY`
  everywhere else.
- Phone widths sit side by side at 1:1; widths from 1024 px stack and scale to the row.
- The light/dark switch forces `data-mode` inside the frame without touching the owner's
  stored preference.
- Choices persist in `localStorage` (`STORAGE_KEYS.PLAYGROUND_VOTES`) and render as a
  plain-text summary the owner pastes back into the conversation.

## Opening a vote

1. Measure the problem first (scroll depth, tap count, a failing state). Taste without a
   finding is not a vote.
2. Add an entry to `OPEN_PLAYGROUND_VOTES` in `playground.votes.ts`: `id` (`s<session>-<topic>`),
   `title`, `question`, `finding`, `route` (locale-free, from `ROUTES_FRONT`), `widths`,
   2–3 `candidates`, and a `prerequisite` when real data needs a specific login.
3. In the product component, branch on the candidate right next to the DZIŚ code:

   ```tsx
   const variant = usePlaygroundVariant('s124-dashboard-clients');
   const visible = variant === 'b' ? pairs.slice(0, 4) : pairs;
   ```

   DZIŚ must stay byte-for-byte the production path when the parameter is absent.
   When the product file sits at its max-lines limit, put the candidates and a thin seam
   component in `<Feature>Vote.organism.tsx` and render the seam instead of the original
   (S124 did this for the dashboard client list: a seam component wrapped the widget, git history of `dashboard/components/PairedClientsVote.organism.tsx`). Layout-only
   candidates can be pure CSS behind a `data-pg-*` attribute (S124 home hero: a `data-pg-hero` attribute on the section, see the git history of
   `HomePage.module.css`).

4. Candidate copy goes through i18n only if it may ship; throwaway labels can stay inline
   in the branch, marked as vote scaffolding.
5. Stay inside the owner's standing taste: modular, app-like, tappable things obvious,
   bold editorial flat, the 7×ZERO floor. S124 rejected text-led editorial layouts.
6. Measure every candidate the same way as DZIŚ and put the numbers in `rationale`.
   Real data often needs a login: `/api/auth/dev-login` with a demo account from
   `.shared-kernel/config/test-users.config.ts`; the frames share the session.

## Palette votes (S125 precedent)

S125 was closed on 2026-10-06: the owner selected **Fuksja gazetowa**.
The selected light and dark tokens live in `styles/themes/palettes.css`; the
production theme identifier stays `rouge-papier` for stored-preference compatibility.
Candidate generation, the palette frames and the `?t=` override were removed with
the vote. Their implementation remains in git history for a future palette vote.

Closing a palette vote means copying the exact winning token contract into the
production palette, removing its registry entry and candidate scaffolding, and
removing only that vote's stored choice. The closed S125 choice is cleared on the
next playground visit; other stored vote entries are preserved.

## Closing a vote

Apply the winner as the only path, delete every `usePlaygroundVariant('<id>')` branch and
the registry entry, add one line to the history note in `Playground.composition.tsx`.
`grep -rn "usePlaygroundVariant" src/UI` must return only the hook itself when no vote is open.
