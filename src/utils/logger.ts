/**
 * Structured logger helper.
 * - debug/info: only emit in development (tree-shaken from production builds)
 * - warn/error: always emit
 *
 * Usage:  import { logger } from '@/utils/logger';
 *         logger.debug('[MyModule] something happened', data);
 */

export const logger = {
  /** Dev-only debug logging — stripped from production bundles */
  debug: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.log(...args);
    }
  },

  /** Dev-only informational logging — stripped from production bundles */
  info: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.info(...args);
    }
  },

  /** Warnings — always emitted (prod + dev) */
  warn: (...args: unknown[]) => {
    console.warn(...args);
  },

  /** Errors — always emitted (prod + dev) */
  error: (...args: unknown[]) => {
    console.error(...args);
  },
};
