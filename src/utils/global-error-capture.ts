/**
 * Global Error Capture — Silently logs client-side JS errors, unhandled promises,
 * and failed network requests to the system_events table.
 * Batches writes every 30s or on page unload.
 */
import { supabase } from '@/integrations/supabase/client';

interface CapturedError {
  message: string;
  stack?: string;
  source?: string;
  page: string;
  fingerprint: string;
  severity: 'error' | 'warning';
  user_agent: string;
  timestamp: string;
}

const errorBuffer: CapturedError[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let installed = false;

/** Simple hash for fingerprinting — truncated to 16 chars */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 16).padEnd(8, '0');
}

function createFingerprint(message: string, source?: string): string {
  const normalized = (message || '').replace(/:\d+/g, ':X').slice(0, 200);
  return simpleHash(`${normalized}|${source || 'unknown'}`);
}

function pushError(err: Omit<CapturedError, 'page' | 'user_agent' | 'timestamp'>) {
  // Deduplicate within current buffer by fingerprint
  if (errorBuffer.some(e => e.fingerprint === err.fingerprint)) return;
  if (errorBuffer.length >= 50) return; // cap buffer

  errorBuffer.push({
    ...err,
    page: window.location.pathname,
    user_agent: navigator.userAgent.slice(0, 200),
    timestamp: new Date().toISOString(),
  });
}

async function flushErrors() {
  if (errorBuffer.length === 0) return;

  const batch = errorBuffer.splice(0, errorBuffer.length);

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // Not logged in — skip

    const rows = batch.map(err => ({
      user_id: user.id,
      event_type: 'client_error',
      severity: err.severity,
      details: {
        message: err.message,
        stack: err.stack?.slice(0, 500),
        source: err.source,
        page: err.page,
        fingerprint: err.fingerprint,
        user_agent: err.user_agent,
        captured_at: err.timestamp,
      },
    }));

    await supabase.from('system_events').insert(rows);
  } catch {
    // Silent fail — don't let monitoring break the app
  }
}

/** Exported for ErrorBoundary and other explicit logging */
export function logErrorToSystem(error: Error, context?: string) {
  const fp = createFingerprint(error.message, context);
  pushError({
    message: error.message,
    stack: error.stack,
    source: context || 'ErrorBoundary',
    fingerprint: fp,
    severity: 'error',
  });
}

/** Install once at app boot */
export function installGlobalErrorCapture() {
  if (installed) return;
  installed = true;

  // JS errors
  window.addEventListener('error', (e) => {
    const fp = createFingerprint(e.message, e.filename);
    pushError({
      message: e.message,
      stack: `${e.filename}:${e.lineno}:${e.colno}`,
      source: e.filename,
      fingerprint: fp,
      severity: 'error',
    });
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
    const stack = e.reason instanceof Error ? e.reason.stack : undefined;
    const fp = createFingerprint(msg, 'promise');
    pushError({
      message: msg,
      stack,
      source: 'unhandledrejection',
      fingerprint: fp,
      severity: 'error',
    });
  });

  // Intercept fetch for 5xx errors
  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    try {
      const res = await origFetch(...args);
      if (res.status >= 500) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || 'unknown';
        const fp = createFingerprint(`HTTP ${res.status}`, url);
        pushError({
          message: `HTTP ${res.status} from ${url.slice(0, 120)}`,
          source: url.slice(0, 200),
          fingerprint: fp,
          severity: 'warning',
        });
      }
      return res;
    } catch (err) {
      throw err; // Don't swallow network errors
    }
  };

  // Flush every 30s
  flushTimer = setInterval(flushErrors, 30_000);

  // Flush on page unload
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushErrors();
    }
  });

  // Flush on beforeunload
  window.addEventListener('beforeunload', () => {
    flushErrors();
  });
}
