# UI playground

**English** | [Polski](README.pl.md)

`/dev/playground` compares temporary variants of live application routes at selected
viewport widths. It uses the current session, data and CSS, so layout decisions can
be checked in context. The route is enabled only in development and staging.

## How variants work

The registry in `playground.votes.ts` defines a question, route, viewport widths
and candidate variants. Each iframe opens the route with
`?pg=<voteId>:<candidateId>`. Components read the parameter through
`usePlaygroundVariant`; outside supported environments the hook returns `null`.

Same-origin framing is controlled by the playground security policy and response
headers. Larger frames are scaled visually while retaining their layout viewport.
A theme switch changes frame attributes without changing the saved preference.
Votes use the registered playground storage key and can be summarized as text.

## Adding and closing a comparison

1. Describe the observed problem and register the candidates.
2. Place a temporary variant branch beside the relevant component behavior.
3. Keep the default route behavior equivalent to the current implementation.
4. Compare relevant widths, locales and states using representative data.
5. Apply the chosen result, then remove the temporary branches and registry entry.

The playground supports a design decision. It is not an automated visual test or
a substitute for checking the selected result after integration.

## Reading guide

- [Variant registry](playground.votes.ts)
- [Frame component](PlaygroundFrame.organism.tsx)
- [Variant hook](../../../shared/hooks/usePlaygroundVariant.ts)
