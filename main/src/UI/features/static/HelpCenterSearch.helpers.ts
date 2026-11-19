// UI/features/static/HelpCenterSearch.helpers.ts
// FAQ search matching for the Help Center: pure, so the matching rules are
// unit-tested (HelpCenterSearch.helpers.test.ts).

/**
 * Case- and diacritic-insensitive form: „Zdjęcie" and „zdjecie" compare equal
 * (people type on phones without Polish letters), German ß folds to ss.
 * `ł` has no Unicode decomposition, so it is mapped by hand.
 */
function foldText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Polish inflects the noun in the FAQ text („sesji inspiracji", „galerię"),
 * so the label on a popular-search chip („Sesja inspiracji", „Galeria") never
 * matched as a whole phrase and the chip answered „no results". Each query
 * word of five or more letters drops its last letter (the case ending) and
 * every word has to appear somewhere in the text. Short words stay whole, so
 * „QR" or „kod" do not turn into noise.
 */
function queryStems(query: string): string[] {
  return foldText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 0)
    .map(word => (word.length >= 5 ? word.slice(0, -1) : word));
}

/**
 * A search is on only when the query has a word to look for. Whitespace or
 * punctuation alone („?", „-") matches everything, so treating it as a search
 * unhid every category at once instead of leaving the tabs as they were.
 */
export function isHelpSearchActive(query: string): boolean {
  return queryStems(query).length > 0;
}

export function matchesHelpQuery(query: string, ...texts: string[]): boolean {
  const stems = queryStems(query);
  if (stems.length === 0) {
    return true;
  }
  const haystack = foldText(texts.join(' '));
  return stems.every(stem => haystack.includes(stem));
}
