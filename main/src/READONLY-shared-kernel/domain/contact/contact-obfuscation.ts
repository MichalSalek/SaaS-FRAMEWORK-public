/** Reversible scraper deterrent, never a secret or an authorization boundary.
 * Keep the build-time generator key in main/scripts/gen-pii.mjs in sync.
 */
const KEY = new TextEncoder().encode('example-placeholder-key');

export function decodePii(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new TextDecoder().decode(
    bytes.map((v, i) => v ^ (KEY[i % KEY.length] ?? 0))
  );
}

export function encodePii(plaintext: string): string {
  const bytes = new TextEncoder().encode(plaintext);
  let binary = '';
  for (const [i, value] of bytes.entries()) {
    binary += String.fromCharCode(value ^ (KEY[i % KEY.length] ?? 0));
  }
  return btoa(binary);
}
