/**
 * Smart arrival date extraction from logistics "situation" column text.
 * 
 * The Chinese shipping agent writes chronological notes like:
 *   "6.14 was received" -> June 14
 *   "Jan 4 was received" -> January 4
 *   "7.7was received" -> July 7 (no space)
 * 
 * Date formats:
 *   - Dot separator (M.D): "6.14" = June 14
 *   - Slash separator (D/M): "14/5" = May 14
 *   - Month name: "Jan 4" = January 4
 *   - Ordinal day only: "on 21st" = day 21 (low confidence)
 */

export interface ArrivalExtraction {
  extracted_arrival: string | null;   // ISO date string YYYY-MM-DD
  arrival_confidence: 'high' | 'low' | null;
  arrival_snippet: string | null;     // The text snippet that matched
}

const DELIVERY_KEYWORDS = /was\s*(?:received|recieved|receievd|delivered)/gi;

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function resolveYear(month: number, day: number, sourceYear: number | null, shipDate: string | null): number {
  const baseYear = sourceYear || new Date().getFullYear();
  if (!shipDate) return baseYear;

  const candidate = new Date(baseYear, month - 1, day);
  const shipped = new Date(shipDate);

  // If candidate is more than 30 days before ship date,
  // it likely crossed a year boundary (e.g. shipped Nov, arrived Jan)
  const diffMs = candidate.getTime() - shipped.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < -30) {
    return baseYear + 1;
  }
  return baseYear;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Basic validity check
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface DateMatch {
  month: number;
  day: number;
  confidence: 'high' | 'low';
  snippet: string;
  index: number; // position in original text
}

/**
 * Find all delivery events and extract dates from each.
 * Returns the LAST one (chronologically last in the text = final delivery).
 */
export function extractArrivalDate(
  situation: string,
  sourceYear: number | null = null,
  shipDate: string | null = null
): ArrivalExtraction {
  if (!situation || situation.trim() === '') {
    return { extracted_arrival: null, arrival_confidence: null, arrival_snippet: null };
  }

  const matches: DateMatch[] = [];

  // Find all delivery keyword positions
  let match: RegExpExecArray | null;
  const keywordRegex = new RegExp(DELIVERY_KEYWORDS.source, 'gi');
  
  while ((match = keywordRegex.exec(situation)) !== null) {
    const keywordIndex = match.index;
    const keywordText = match[0];
    
    // Look at the text BEFORE this keyword (within ~30 chars) for a date
    const lookback = situation.substring(Math.max(0, keywordIndex - 40), keywordIndex);
    const fullSnippet = lookback.trimStart() + keywordText;
    
    // Pattern 1: M.D format right before keyword — "6.14 was received" or "7.7was received"
    const dotMatch = lookback.match(/(\d{1,2})\.(\d{1,2})\s*$/);
    if (dotMatch) {
      const month = parseInt(dotMatch[1]);
      const day = parseInt(dotMatch[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        matches.push({ month, day, confidence: 'high', snippet: fullSnippet.trim(), index: keywordIndex });
        continue;
      }
    }

    // Pattern 2: D/M format — "14/5 was received"
    const slashMatch = lookback.match(/(\d{1,2})\/(\d{1,2})\s*$/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1]);
      const month = parseInt(slashMatch[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        matches.push({ month, day, confidence: 'high', snippet: fullSnippet.trim(), index: keywordIndex });
        continue;
      }
    }

    // Pattern 3: Month name + day — "Jan 4 was received"
    const monthNameMatch = lookback.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\s*$/i);
    if (monthNameMatch) {
      const month = MONTH_NAMES[monthNameMatch[1].toLowerCase().substring(0, 3)];
      const day = parseInt(monthNameMatch[2]);
      if (month && day >= 1 && day <= 31) {
        matches.push({ month, day, confidence: 'high', snippet: fullSnippet.trim(), index: keywordIndex });
        continue;
      }
    }

    // Pattern 4: Ordinal day only — "on 21st" or "22th was received"
    const ordinalMatch = lookback.match(/\b(\d{1,2})(?:st|nd|rd|th)\s*$/i);
    if (ordinalMatch) {
      const day = parseInt(ordinalMatch[1]);
      if (day >= 1 && day <= 31) {
        // Try to infer month from the most recent explicit date in text before this point
        const inferredMonth = inferMonthFromContext(situation, keywordIndex, sourceYear, shipDate);
        if (inferredMonth) {
          matches.push({ month: inferredMonth, day, confidence: 'low', snippet: fullSnippet.trim(), index: keywordIndex });
        }
        continue;
      }
    }
  }

  if (matches.length === 0) {
    return { extracted_arrival: null, arrival_confidence: null, arrival_snippet: null };
  }

  // Take the LAST match (final delivery event in chronological log)
  const last = matches[matches.length - 1];
  const year = resolveYear(last.month, last.day, sourceYear, shipDate);
  const iso = toIso(year, last.month, last.day);

  if (!iso) {
    return { extracted_arrival: null, arrival_confidence: null, arrival_snippet: null };
  }

  return {
    extracted_arrival: iso,
    arrival_confidence: last.confidence,
    arrival_snippet: last.snippet,
  };
}

/**
 * Try to infer month from explicit dates near the ambiguous reference.
 * Looks backwards in the text for the most recent M.D or D/M date.
 */
function inferMonthFromContext(
  text: string,
  beforeIndex: number,
  sourceYear: number | null,
  shipDate: string | null
): number | null {
  const preceding = text.substring(0, beforeIndex);
  
  // Find the last M.D date in the preceding text
  const allDotDates = [...preceding.matchAll(/(\d{1,2})\.(\d{1,2})/g)];
  if (allDotDates.length > 0) {
    const lastDot = allDotDates[allDotDates.length - 1];
    const month = parseInt(lastDot[1]);
    if (month >= 1 && month <= 12) return month;
  }

  // Fallback: use shipDate month if available
  if (shipDate) {
    const parts = shipDate.split('-');
    if (parts.length === 3) return parseInt(parts[1]);
  }

  return null;
}
