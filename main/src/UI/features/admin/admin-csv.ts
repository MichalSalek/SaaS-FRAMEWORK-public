// UI/features/admin/admin-csv.ts
// The one CSV download of the admin panel (audit trail, reports, users):
// escaping and the browser download. Each page decides its own columns and rows.

// A cell starting with one of these is read as a formula by spreadsheets
// (CSV injection): a user-written name „=HYPERLINK(...)” would run on open.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** A cell value as one CSV field (RFC 4180 quoting, formula-safe). */
export function escapeCSVField(value: string): string {
  // A plain negative number is data, not a formula: it stays a number.
  const safe =
    FORMULA_START.test(value) && !PLAIN_NUMBER.test(value)
      ? `'${value}`
      : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** The whole file as text: header line, then one line per row. */
export function buildCSVContent(
  header: readonly string[],
  rows: readonly (readonly string[])[]
): string {
  const toLine = (cells: readonly string[]): string =>
    cells.map(escapeCSVField).join(',');
  return [header, ...rows].map(toLine).join('\n');
}

/**
 * Downloads `rows` under `header` as `<fileBaseName>-<YYYY-MM-DD>.csv`.
 * Cells are escaped here; callers pass plain strings.
 */
export function downloadCSV(
  fileBaseName: string,
  header: readonly string[],
  rows: readonly (readonly string[])[]
): void {
  // The byte order mark makes spreadsheets read the file as UTF-8 (Polish
  // letters in names and headers); without it Excel shows them garbled.
  const blob = new Blob(['﻿', buildCSVContent(header, rows)], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBaseName}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
