# Frontend domain declarations

**English** | [Polski](README.pl.md)

This directory groups typed API calls by business area. It connects the shared
contract with the transport factories in `application/http/io.ts`. It does not
implement the backend's business operations.

## Structure

A directory such as `favorites/`, `gallery/` or `pairing/` contains endpoint
functions using shared request and response types. Hooks and screens import those
functions rather than assembling URLs and HTTP options themselves.

```text
shared DTO and route
  -> domain endpoint declaration
  -> feature query or mutation hook
  -> screen
```

## Responsibilities

Declarations select the route, method and contract types. Transport handles the
request and response envelope. Feature hooks own loading state, cache invalidation,
optimistic updates and local feedback decisions.

This separation makes a contract change visible at the declaration and consuming
call sites, while keeping query behavior close to the feature. Uploads and selected
authentication flows have documented transport exceptions in `io.ts`.

## Reading guide

- [Favorites declarations](favorites/favoriteIO.possibilities.api.ts)
- [Pairing guide](pairing/README.md)
- [Transport factories](../application/http/io.ts)
- [Frontend overview](../../README.md)
