# Browser tests

**English** | [Polski](README.pl.md)

Playwright exercises selected user journeys on the development stack: login,
session persistence, role-based navigation, pairing entry points and account pages.
API smoke tests cover endpoint rules in more detail.

## Requirements

The browser suite requires a configured development stack and browser dependencies. The export omits parts of that setup.

## Configuration

The suite uses one worker because scenarios share seeded accounts and a database.
Chromium projects cover desktop and a narrow phone viewport. The configuration
expects an already running stack rather than starting containers. Failure artifacts
include traces, screenshots and video according to `playwright.config.ts`.

Helpers inject bearer tokens for authenticated setup, call the API to prepare data
and clean up after scenarios. Tests use semantic selectors where possible.

## Scope and limits

The spec directory is the coverage reference. Selected tests check page rendering
or funnel entry rather than an entire external-provider interaction. Cloudinary
uploads, completed Stripe payment challenges and destructive account cycles need
additional targeted verification. A phone viewport is not an Android device test.

## Reading guide

- [Configuration](playwright.config.ts)
- [Authentication helper](helpers/auth.ts)
- [Session persistence](specs/16-auth-session-persistence.spec.ts)
