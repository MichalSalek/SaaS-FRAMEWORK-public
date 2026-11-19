import { hasTrustedInteraction } from '../security/trusted-interaction';
import { mapContactMessages } from './contact-messages';

// Toast strings (`events.json`) for pages that do not ship them in
// `__NEXT_DATA__` (public pages, DECISION at getPublicPageMessages in
// i18n.loader.ts). Loaded on the first toast, once per locale per visit.

export type EventsMessages = Readonly<Record<string, string>>;

const loaded = new Map<string, Promise<EventsMessages>>();

// A literal import per locale: webpack emits one small chunk for each file
// and never bundles the three into the page.
function importEvents(locale: string): Promise<{ default: unknown }> {
  if (locale === 'de') {
    return import('../../locales/de/events.json');
  }
  if (locale === 'en') {
    return import('../../locales/en/events.json');
  }
  return import('../../locales/pl/events.json');
}

/**
 * Resolves to the event-key → text map of `locale`. A failed chunk load
 * resolves to an empty map (the toast then shows its message as given) and
 * is not cached, so the next caller tries the network again.
 */
export function loadEventsMessages(locale: string): Promise<EventsMessages> {
  const pending = loaded.get(locale);
  const visible = (messages: EventsMessages): EventsMessages =>
    mapContactMessages(
      messages,
      hasTrustedInteraction() ? 'revealed' : 'hidden'
    );
  if (pending) {
    return pending.then(visible);
  }
  const next = importEvents(locale).then(
    module => module.default as EventsMessages,
    () => {
      loaded.delete(locale);
      return {};
    }
  );
  loaded.set(locale, next);
  return next.then(visible);
}
