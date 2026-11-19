/**
 * Public identity reveal uses reversible obfuscation, not secret encryption.
 * SSR and the first client render show a neutral placeholder. Values reveal
 * after a trusted input event through the shared interaction gate.
 * This deters direct HTTP harvesters and synthetic dispatchEvent scripts;
 * browser automation using real input can pass the gate and read the values.
 * Company, tax ID and address use this component or renderLegalText(). Public
 * email messages and links share the same gate through their contact helpers.
 */
import { Fragment, type ReactNode } from 'react';
import { PII, decodePii } from './pii.crypto';
import { useTrustedInteraction } from '../../shared/interaction/trusted-interaction';

/** Neutral placeholder before reveal; NOT a blob (clean for crawlers and screen readers). */
const PLACEHOLDER = '…';

/** Inline obfuscated text (company, tax ID, address). SSR / before interaction = „…”. */
// DECISION: the PiiTextAtom export is required by audit:atomic-coverage (a *.atom.tsx file MUST
// export a *Atom symbol) even though the only consumer is renderLegalText in this same file. Do
// not remove the export without changing the atomic-coverage contract.
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
 * Renders a legal-text paragraph, replacing PII tokens (`__PII_FIRMA__`,
 * `__PII_NIP__`, `__PII_ADRES__`) with an obfuscated <PiiTextAtom>. Plain text
 * passes through unchanged. Value SSOT: pii.crypto.ts.
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
