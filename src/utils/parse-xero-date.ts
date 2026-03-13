/**
 * Parses Xero date fields into ISO date strings (YYYY-MM-DD).
 * Handles: ISO strings, Xero .NET JSON /Date(...)/ format.
 * Returns null for invalid/missing inputs.
 */
export function parseXeroDate(dateField: string | null | undefined): string | null {
  if (!dateField) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateField)) return dateField.split('T')[0];
  const raw = dateField.replace('/Date(', '').replace(')/', '').split('+')[0];
  const ts = parseInt(raw);
  if (!isNaN(ts) && ts > 100000000000) return new Date(ts).toISOString().split('T')[0];
  if (!isNaN(ts)) return null;
  return null;
}
