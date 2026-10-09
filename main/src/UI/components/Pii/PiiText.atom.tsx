/**
 * PII rendering — anti-crawler obfuscation (patrz `pii.crypto.ts`).
 *
 * DWIE warstwy obrony:
 *  1. SSR/przed-interakcją renderuje neutralny placeholder „…" — NIE zaszyfrowany
 *     blob. Krzaki (encoded) żyją tylko w JS-bundlu (stałe `PII`), więc crawler /
 *     View Source / harvester / screen-reader nie widzi ani plaintextu, ani bloba.
 *  2. Odkodowanie NIE następuje na mount — dopiero po PIERWSZEJ ZAUFANEJ interakcji
 *     użytkownika (ruch myszy / pointer / wheel / tap / klawisz / klik). Pokonuje
 *     też crawlery WYKONUJĄCE JS (renderują stronę, ale nie symulują interakcji)
 *     → nigdy nie odkodują wartości.
 *
 * ⛔ Każda nazwa firmy / NIP / adres na froncie MUSI iść przez <PiiTextAtom> albo
 *    renderLegalText() (tokeny __PII_*__ w treści i18n stron prawnych).
 *
 * ⚠️ Brama interakcji (zaufane eventy, bez 'scroll'/'focusin', filtr isTrusted)
 *    została WYEKSTRAHOWANA do reużywalnego SSOT:
 *    `src/UI/shared/interaction/trusted-interaction.ts` (współdzielona z
 *    formularzami publicznymi / Turnstile). Pełne uzasadnienie doboru eventów
 *    i filtra isTrusted — tam.
 */
import { Fragment, type ReactNode } from 'react';
import { PII, decodePii } from './pii.crypto';
import { useTrustedInteraction } from '../../shared/interaction/trusted-interaction';

/** Neutralny placeholder przed odsłonięciem — NIE blob (czysty dla crawlera i SR). */
const PLACEHOLDER = '…';

/** Inline zaszyfrowany tekst (firma, NIP, adres). SSR/przed-interakcją = „…". */
// DECISION (nie usuwaj tego komentarza):
// Eksport PiiTextAtom jest wymagany przez audit:atomic-coverage (plik *.atom.tsx
// MUSI eksportować symbol *Atom), mimo że jedyny konsument to renderLegalText
// w tym samym pliku. Knip ignoruje ten plik (knip.json) z tego właśnie powodu —
// NIE usuwaj eksportu i NIE zdejmuj ignore bez zmiany kontraktu atomic-coverage.
export function PiiTextAtom({
  enc,
  className,
}: {
  enc: string;
  className?: string;
}): ReactNode {
  const revealed = useTrustedInteraction();
  return (
    <span className={className} suppressHydrationWarning>
      {revealed ? decodePii(enc) : PLACEHOLDER}
    </span>
  );
}

const TOKEN_TO_ENC: Record<string, string> = {
  __PII_FIRMA__: PII.firma,
  __PII_NIP__: PII.nip,
  __PII_ADRES__: PII.address,
};

/**
 * Renderuje akapit treści prawnej, podmieniając tokeny PII (`__PII_FIRMA__`,
 * `__PII_NIP__`, `__PII_ADRES__`) na obfuskowany <PiiTextAtom>. Zwykły tekst
 * przechodzi bez zmian. SSOT wartości: pii.crypto.ts.
 */
export function renderLegalText(text: string): ReactNode {
  const parts = text.split(/(__PII_FIRMA__|__PII_NIP__|__PII_ADRES__)/g);
  if (parts.length === 1) {
    return text;
  }
  return parts.map((part, i) => {
    const enc = TOKEN_TO_ENC[part];
    return enc ? (
      <PiiTextAtom key={i} enc={enc} />
    ) : (
      <Fragment key={i}>{part}</Fragment>
    );
  });
}
