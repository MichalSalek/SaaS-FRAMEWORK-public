# Stylist and client journey

The [Playwright scenario](stylist-client.journey.ts) opens separate browser contexts for a stylist and a client. The stylist signs in through an email link, creates a portfolio entry, and shares a public profile. The client visits that profile and sends a pairing request. When the stylist accepts, the client can open the gallery.

The test uses a local mail sink and a simulated image provider. It exercises the browser, API and database together and expects an isolated application stack. The public sample includes the scenario, its fixtures and the [Playwright configuration](playwright.journey.config.ts). The environment used to run it is managed separately.
