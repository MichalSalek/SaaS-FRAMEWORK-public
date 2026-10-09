// gen-pii.mjs — GENERATOR zaszyfrowanych stałych PII dla
// src/UI/components/Pii/pii.crypto.ts (anti-crawler / anti-scraper).
//
// PO CO: na froncie (SSR HTML + client bundle) NIE może być plaintextu danych
// identyfikujących właściciela (nazwa firmy, NIP, adres siedziby). Trzymamy je
// WYŁĄCZNIE w formie zaszyfrowanej (XOR+base64); JS odkodowuje je dopiero w
// przeglądarce, po pierwszej zaufanej interakcji użytkownika. Crawler /
// View Source / email-harvester / indekser widzi tylko krzaki (a w SSR „…").
//
// TEN PLIK = jedyne miejsce z plaintextem PII (dev-only, NIE jest importowany
// przez aplikację → nie trafia do bundla). W tej publicznej migawce SOURCE i
// KEY to wartości przykładowe (placeholdery), nie dane produkcyjne.
//
// UŻYCIE:  node scripts/gen-pii.mjs
// Skopiuj wypluty blok `PII = { ... }` do src/UI/components/Pii/pii.crypto.ts.
// Algorytm tutaj MUSI być identyczny (odwracalnie) jak decodePii w pii.crypto.ts
// — encodePii żyje TYLKO tutaj (dead-code cleanup 2026-07: front nie koduje).
//
// Tożsamość = jednoosobowa działalność (NIP, brak KRS).

const KEY = new TextEncoder().encode('example-placeholder-key');

function encodePii(plain) {
  const bytes = new TextEncoder().encode(plain);
  const xored = bytes.map((v, i) => v ^ KEY[i % KEY.length]);
  let bin = '';
  xored.forEach((v) => {
    bin += String.fromCharCode(v);
  });
  return Buffer.from(bin, 'binary').toString('base64');
}

function decodePii(b64) {
  const bin = Buffer.from(b64, 'base64').toString('binary');
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const xored = bytes.map((v, i) => v ^ KEY[i % KEY.length]);
  return new TextDecoder().decode(xored);
}

// === PLAINTEXT PII (jedyne miejsce w całym repo) ===
// Klucz w obiekcie = nazwa stałej w pii.crypto.ts. Wartość = plaintext do zaszyfrowania.
const SOURCE = {
  firma: 'Example Studio Jan Kowalski',
  nip: '1234567890',
  address: 'ul. Przykładowa 1, 00-000 Warszawa',
};

let allOk = true;
const lines = [];
for (const [k, plain] of Object.entries(SOURCE)) {
  const enc = encodePii(plain);
  const roundtrip = decodePii(enc);
  const ok = roundtrip === plain;
  if (!ok) allOk = false;
  // UWAGA: NIE drukujemy plaintextu w komentarzu — pełny output bywa wklejany
  // do pii.crypto.ts; plaintext w komentarzu trafiłby wtedy do src/. Round-trip
  // jest weryfikowany niżej (linia ROUND-TRIP), wartości czytaj z SOURCE powyżej.
  lines.push(`  ${k}: '${enc}', // ${ok ? 'OK' : 'FAIL'}`);
}

console.log('export const PII = {');
console.log(lines.join('\n'));
console.log('} as const;');
console.log('');
console.log(allOk ? '// ROUND-TRIP: ALL OK' : '// ROUND-TRIP: FAIL');
