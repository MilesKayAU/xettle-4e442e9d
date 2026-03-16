/**
 * AI Context Contract — Single source of truth for page context shape.
 *
 * ALL pages register context via useAiPageContext(builderFn).
 * The sanitizer enforces size limits, PII redaction, and DOM blocking.
 *
 * This is NOT a DOM dump. It's structured, minimal, and deterministic.
 */

// ─── Route IDs (stable enum, not raw pathnames) ──────────────────────────────

export type AiRouteId =
  | 'dashboard'
  | 'outstanding'
  | 'settlements'
  | 'insights'
  | 'settings'
  | 'smart_upload'
  | 'settlement_detail'
  | 'rail_posting_settings'
  | 'push_safety_preview'
  | 'xero_posting_audit'
  | 'admin'
  | 'setup'
  | 'unknown';

// ─── Context Schema ──────────────────────────────────────────────────────────

export interface AiPageContext {
  /** Stable route identifier */
  routeId: AiRouteId;

  /** Human-readable page title */
  pageTitle: string;

  /** Primary entity IDs visible on the page */
  primaryEntities: {
    settlement_ids?: string[];
    xero_invoice_ids?: string[];
    marketplace_codes?: string[];
    rail?: string;
  };

  /** Small summary numbers — counts, totals, flags */
  pageStateSummary: Record<string, string | number | boolean>;

  /** What the user has selected (rows, filters) */
  userSelections?: {
    selected_ids?: string[];
    active_filters?: Record<string, string>;
  };

  /** Column names + limited row data from visible tables */
  visibleTables?: Array<{
    name: string;
    columns: string[];
    row_count: number;
    sample_rows?: Array<Record<string, string | number | boolean | null>>;
  }>;

  /** What actions the assistant may propose */
  capabilities?: string[];

  /** Suggested questions for this page */
  suggestedPrompts?: string[];
}

// ─── Safety Constants ────────────────────────────────────────────────────────

const MAX_CONTEXT_BYTES = 2048;
const MAX_ROWS_PER_TABLE = 20;
const MAX_FIELDS_PER_ROW = 10;
const MAX_ENTITY_IDS = 20;

/** Keys whose values should be redacted */
const PII_KEYS = new Set([
  'email', 'address', 'phone', 'abn', 'tfn', 'tax_file_number',
  'narration', 'bank_narration', 'password', 'secret', 'token',
  'access_token', 'refresh_token', 'api_key',
]);

/** Patterns that indicate DOM content — hard blocked */
const DOM_PATTERNS = [
  /innerHTML/i, /outerHTML/i, /document\.body/i, /innerText/i,
  /<\s*div/i, /<\s*span/i, /<\s*table/i, /<\s*script/i,
];

// ─── Sanitizer ───────────────────────────────────────────────────────────────

function redactValue(key: string, value: unknown): unknown {
  if (typeof key === 'string' && PII_KEYS.has(key.toLowerCase())) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    // Block DOM content
    for (const pat of DOM_PATTERNS) {
      if (pat.test(value)) return '[DOM_BLOCKED]';
    }
    // Truncate long strings
    if (value.length > 200) return value.slice(0, 200) + '…';
  }
  return value;
}

function truncateIds(ids: string[] | undefined): string[] | undefined {
  if (!ids) return undefined;
  return ids.slice(0, MAX_ENTITY_IDS);
}

function sanitizeRows(
  rows?: Array<Record<string, unknown>>,
): Array<Record<string, string | number | boolean | null>> | undefined {
  if (!rows) return undefined;
  return rows.slice(0, MAX_ROWS_PER_TABLE).map(row => {
    const entries = Object.entries(row).slice(0, MAX_FIELDS_PER_ROW);
    const clean: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of entries) {
      const val = redactValue(k, v);
      if (val === null) {
        clean[k] = null;
      } else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        clean[k] = val;
      } else {
        clean[k] = String(val);
      }
    }
    return clean;
  });
}

/**
 * Sanitize and truncate an AiPageContext to fit within safety limits.
 * Priority order: routeId + pageTitle → primaryEntities → pageStateSummary → rest
 */
export function sanitizeContext(ctx: AiPageContext): AiPageContext {
  const sanitized: AiPageContext = {
    routeId: ctx.routeId,
    pageTitle: ctx.pageTitle.slice(0, 100),
    primaryEntities: {
      settlement_ids: truncateIds(ctx.primaryEntities.settlement_ids),
      xero_invoice_ids: truncateIds(ctx.primaryEntities.xero_invoice_ids),
      marketplace_codes: ctx.primaryEntities.marketplace_codes?.slice(0, 10),
      rail: ctx.primaryEntities.rail,
    },
    pageStateSummary: {},
    capabilities: ctx.capabilities?.slice(0, 10),
    suggestedPrompts: ctx.suggestedPrompts?.slice(0, 5),
  };

  // Sanitize pageStateSummary values
  for (const [k, v] of Object.entries(ctx.pageStateSummary)) {
    const clean = redactValue(k, v);
    if (typeof clean === 'string' || typeof clean === 'number' || typeof clean === 'boolean') {
      sanitized.pageStateSummary[k] = clean;
    }
  }

  // Sanitize userSelections
  if (ctx.userSelections) {
    sanitized.userSelections = {
      selected_ids: ctx.userSelections.selected_ids?.slice(0, MAX_ENTITY_IDS),
      active_filters: ctx.userSelections.active_filters,
    };
  }

  // Sanitize visibleTables
  if (ctx.visibleTables) {
    sanitized.visibleTables = ctx.visibleTables.slice(0, 3).map(t => ({
      name: t.name,
      columns: t.columns.slice(0, MAX_FIELDS_PER_ROW),
      row_count: t.row_count,
      sample_rows: sanitizeRows(t.sample_rows),
    }));
  }

  // Enforce byte cap — drop lowest-priority fields if over limit
  let json = JSON.stringify(sanitized);
  if (json.length > MAX_CONTEXT_BYTES) {
    delete sanitized.visibleTables;
    json = JSON.stringify(sanitized);
  }
  if (json.length > MAX_CONTEXT_BYTES) {
    delete sanitized.userSelections;
    json = JSON.stringify(sanitized);
  }
  if (json.length > MAX_CONTEXT_BYTES) {
    sanitized.suggestedPrompts = sanitized.suggestedPrompts?.slice(0, 2);
  }

  return sanitized;
}

// ─── Default empty context ───────────────────────────────────────────────────

export const EMPTY_CONTEXT: AiPageContext = {
  routeId: 'unknown',
  pageTitle: 'Xettle',
  primaryEntities: {},
  pageStateSummary: {},
};
