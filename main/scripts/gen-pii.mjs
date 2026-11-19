// gen-pii.mjs — GENERATOR of the encrypted PII constants for
// src/UI/components/Pii/pii.crypto.ts (anti-crawler / anti-scraper).
//
// WHY: the front end (SSR HTML + client bundle) must hold no plaintext of the owner's identifying
// data (company name, tax id, registered address). It is kept ONLY encrypted (XOR + base64); JS
// decodes it in the browser after the first trusted user interaction. A crawler, View Source, an
// e-mail harvester or an indexer sees only gibberish (in SSR: "…").
//
// THIS FILE is the only place with plaintext PII (dev-only, NOT imported by the app, so it never
// reaches the bundle; the repo is private).
//
// USAGE:  node scripts/gen-pii.mjs, then copy the printed `PII = { ... }` block into
// src/UI/components/Pii/pii.crypto.ts. The algorithm here MUST stay reversibly identical to
// decodePii in pii.crypto.ts; encodePii lives ONLY here (the front end never encodes).

const KEY = new TextEncoder().encode('example-placeholder-key');

function encodePii(plain) {
  const bytes = new TextEncoder().encode(plain);
  const xored = bytes.map((v, i) => v ^ KEY[i % KEY.length]);
  let bin = '';
  xored.forEach(v => {
    bin += String.fromCharCode(v);
  });
  return Buffer.from(bin, 'binary').toString('base64');
}

function decodePii(b64) {
  const bin = Buffer.from(b64, 'base64').toString('binary');
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const xored = bytes.map((v, i) => v ^ KEY[i % KEY.length]);
  return new TextDecoder().decode(xored);
}

// === PLAINTEXT PII (the only place in the repo) ===
// Object key = the constant's name in pii.crypto.ts. Value = plaintext to encrypt.
const SOURCE = {
  firma: 'Example Studio Jan Kowalski',
  nip: 'EXAMPLE-TAX-0001',
  address: 'ul. Przykładowa 1, 00-000 Warszawa',
};

let allOk = true;
const lines = [];
for (const [k, plain] of Object.entries(SOURCE)) {
  const enc = encodePii(plain);
  const roundtrip = decodePii(enc);
  const ok = roundtrip === plain;
  if (!ok) allOk = false;
  // Do NOT print the plaintext in the comment: the full output gets pasted into pii.crypto.ts, so
  // plaintext there would land in src/. The round trip is checked below (ROUND-TRIP line); read
  // the values from SOURCE above.
  lines.push(`  ${k}: '${enc}', // ${ok ? 'OK' : 'FAIL'}`);
}

console.log('export const PII = {');
console.log(lines.join('\n'));
console.log('} as const;');
console.log('');
console.log(allOk ? '// ROUND-TRIP: ALL OK' : '// ROUND-TRIP: FAIL');
