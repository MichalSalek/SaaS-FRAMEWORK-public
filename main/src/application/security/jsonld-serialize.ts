// DECISION (nie usuwaj tego komentarza) — escape at the SINK:
// JSON.stringify leaves `<` as is, so a string containing `</script>` would close
// this block. Escaping `<`, `>`, `&` and the two JS line separators to \u escapes keeps
// the JSON identical for parsers (Google reads the same values) and makes every
// JSON-LD payload safe regardless of which field a future call site forgets.
export const serializeJsonLd = (item: unknown): string =>
  JSON.stringify(item)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
