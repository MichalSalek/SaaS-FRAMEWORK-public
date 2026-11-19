import { mapContactMessages } from '../i18n/contact-messages';

// DECISION: escape at the SINK. JSON.stringify leaves `<` as is, so a string containing `</script>`
// would close the block. Escaping `<`, `>`, `&` and the two JS line separators to \u escapes keeps
// the JSON identical for parsers (Google reads the same values) and makes every JSON-LD payload safe
// whichever field a future call site forgets. Per-field HTML-entity escaping is wrong here: it puts a
// literal `&amp;` into data Google reads.
export const serializeJsonLd = (item: unknown): string =>
  JSON.stringify(mapContactMessages(item, 'crawler'))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
