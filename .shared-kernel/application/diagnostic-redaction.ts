/** Note text stays out of diagnostics; a new compound note key must not bypass redaction. */
export function isPrivateNoteKey(key: string): boolean {
  return /notes?$/.test(key.toLowerCase().replace(/[_\-.]/g, ''));
}
