export type CsvCell = string | number | boolean | null | undefined;

/**
 * Serialise rows as RFC 4180 CSV. Text cells that a spreadsheet would treat as a formula
 * (leading = + - @ tab CR) are prefixed with an apostrophe to prevent CSV injection.
 */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const cell = (value: CsvCell): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    let s = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
