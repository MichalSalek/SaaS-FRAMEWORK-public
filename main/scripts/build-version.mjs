/** One immutable stamp is inherited by every Next build worker. */
export function buildVersion(date = new Date()) {
  return date
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, '')
    .replace(/^(\d{8})(\d{4})$/, '$1.$2');
}
