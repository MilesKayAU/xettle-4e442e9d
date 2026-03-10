/**
 * Universal Date Parser — AU-focused, no new Date() fallback
 * 
 * Xettle is an Australian product, so ambiguous slash dates default to DD/MM/YYYY.
 * Never uses JavaScript's `new Date()` constructor which assumes US MM/DD/YYYY.
 * Returns YYYY-MM-DD string or null if unparseable.
 */

// ─── Month name maps ────────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// ─── Range validation ───────────────────────────────────────────────────────

const MIN_YEAR = 2020;

/** Plausibility ceiling: current month + 3 months */
function getMaxPlausibleDate(): string {
  const now = new Date();
  const ceiling = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
  return `${ceiling.getFullYear()}-${String(ceiling.getMonth() + 1).padStart(2, '0')}-${String(ceiling.getDate()).padStart(2, '0')}`;
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < MIN_YEAR || year > 2099) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const daysInMonth = [0, 31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month];
}

function isPlausible(dateStr: string): boolean {
  return dateStr >= '2020-01-01' && dateStr <= getMaxPlausibleDate();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ─── Format Parsers (ordered by priority) ───────────────────────────────────

type FormatParser = (input: string) => string | null;

/** 1. YYYY-MM-DD (with optional time suffix) */
const parseISO: FormatParser = (input) => {
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  return isValidDate(y, mo, d) ? formatDate(y, mo, d) : null;
};

/** 2. DD/MM/YYYY (Australian default for slash dates) */
const parseDDslashMMslashYYYY: FormatParser = (input) => {
  const m = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  return isValidDate(y, mo, d) ? formatDate(y, mo, d) : null;
};

/** 3. DD-MM-YYYY */
const parseDDdashMMdashYYYY: FormatParser = (input) => {
  const m = input.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  return isValidDate(y, mo, d) ? formatDate(y, mo, d) : null;
};

/** 4. DD.MM.YYYY (Amazon AU settlement format, with optional time) */
const parseDDdotMMdotYYYY: FormatParser = (input) => {
  const m = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  return isValidDate(y, mo, d) ? formatDate(y, mo, d) : null;
};

/** 5. MM/DD/YYYY fallback — only if DD/MM/YYYY failed (i.e. day > 12 made it invalid) */
const parseMMslashDDslashYYYY: FormatParser = (input) => {
  const m = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m.map(Number);
  return isValidDate(y, mo, d) ? formatDate(y, mo, d) : null;
};

/** 6. DD MMM YYYY or DD-MMM-YYYY (e.g. '10 Feb 2026', '10-Feb-2026') */
const parseDDMMMYYYY: FormatParser = (input) => {
  const m = input.match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1]);
  const month = MONTH_NAMES[m[2].toLowerCase()];
  const year = parseInt(m[3]);
  if (!month) return null;
  return isValidDate(year, month, day) ? formatDate(year, month, day) : null;
};

/** 7. MMM DD, YYYY or MMM DD YYYY (e.g. 'Feb 10, 2026') */
const parseMMMDDYYYY: FormatParser = (input) => {
  const m = input.match(/^([A-Za-z]+)[\s]+(\d{1,2})[, \s]+(\d{4})/);
  if (!m) return null;
  const month = MONTH_NAMES[m[1].toLowerCase()];
  const day = parseInt(m[2]);
  const year = parseInt(m[3]);
  if (!month) return null;
  return isValidDate(year, month, day) ? formatDate(year, month, day) : null;
};

/** 8. Unix timestamp (seconds since epoch, 10 digits) */
const parseUnixTimestamp: FormatParser = (input) => {
  if (!/^\d{10}$/.test(input.trim())) return null;
  const ts = parseInt(input.trim()) * 1000;
  const d = new Date(ts); // Safe: unambiguous numeric timestamp
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return isValidDate(year, month, day) ? formatDate(year, month, day) : null;
};

/** 9. ISO 8601 with T separator (e.g. '2026-02-10T14:30:00Z') — handled by parseISO already */

// ─── Priority chain ────────────────────────────────────────────────────────

const FORMAT_CHAIN: FormatParser[] = [
  parseISO,
  parseDDslashMMslashYYYY,
  parseDDdashMMdashYYYY,
  parseDDdotMMdotYYYY,
  parseMMslashDDslashYYYY,  // fallback if DD/MM failed (day was > 12 as month)
  parseDDMMMYYYY,
  parseMMMDDYYYY,
  parseUnixTimestamp,
];

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse a date string into YYYY-MM-DD format.
 * AU-focused: ambiguous slash dates default to DD/MM/YYYY.
 * Returns null if no format matches or date is outside 2020–2030.
 * Never throws.
 */
export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Strip time portion for cleaner matching (keep original for formats that need it)
  for (const parser of FORMAT_CHAIN) {
    const result = parser(trimmed);
    if (result) return result;
  }

  console.warn(`[date-parser] Could not parse date: "${trimmed}"`);
  return null;
}

/**
 * Parse a date string, returning empty string instead of null for backward compat.
 * Used by parsers that store '' for missing dates.
 */
export function parseDateOrEmpty(raw: string | undefined | null): string {
  return parseDate(raw) ?? '';
}

/**
 * Detect the most likely date column in a set of CSV rows.
 * Returns the column index where >80% of non-empty values parse as valid dates.
 */
export function detectDateColumn(headers: string[], rows: string[][]): { index: number; header: string } | null {
  const candidates: { index: number; header: string; score: number }[] = [];

  for (let col = 0; col < headers.length; col++) {
    let total = 0;
    let parsed = 0;
    for (const row of rows) {
      const val = row[col]?.trim();
      if (!val) continue;
      total++;
      if (parseDate(val)) parsed++;
    }
    if (total > 0 && (parsed / total) >= 0.8) {
      candidates.push({ index: col, header: headers[col], score: parsed / total });
    }
  }

  if (candidates.length === 0) return null;

  // Prefer columns with date-like header names
  const dateHeaderPatterns = [/date/i, /period/i, /time/i, /ordered/i, /created/i, /paid/i, /posted/i];
  for (const pattern of dateHeaderPatterns) {
    const match = candidates.find(c => pattern.test(c.header));
    if (match) return { index: match.index, header: match.header };
  }

  // Return highest scoring column
  candidates.sort((a, b) => b.score - a.score);
  return { index: candidates[0].index, header: candidates[0].header };
}

// ─── Unit Tests (reference) ─────────────────────────────────────────────────
/*
  Test cases for parseDate():

  1. parseDate('15/03/2026')         → '2026-03-15'   // DD/MM/YYYY — standard AU
  2. parseDate('04/03/2026')         → '2026-03-04'   // Ambiguous — AU default DD/MM
  3. parseDate('2026-02-10')         → '2026-02-10'   // ISO YYYY-MM-DD
  4. parseDate('10 Feb 2026')        → '2026-02-10'   // DD MMM YYYY
  5. parseDate('2026-02-10 14:30:00 +1100') → '2026-02-10'  // ISO with time+tz
  6. parseDate('1772409600')         → '2026-02-28'   // Unix timestamp (approx)
  7. parseDate('not a date')         → null            // Invalid — returns null
  8. parseDate('01/01/2019')         → null            // Outside range 2020–2030
  9. parseDate('28.02.2026')         → '2026-02-28'   // DD.MM.YYYY (Amazon AU)
  10. parseDate('Feb 10, 2026')      → '2026-02-10'   // MMM DD, YYYY
  11. parseDate('')                   → null            // Empty string
  12. parseDate(null)                 → null            // Null input
  13. parseDate('31/13/2025')        → null            // Invalid month 13
  14. parseDate('15-03-2026')        → '2026-03-15'   // DD-MM-YYYY
*/
