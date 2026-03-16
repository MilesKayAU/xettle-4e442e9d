/**
 * Structured logger for Deno edge functions.
 * - debug/info: suppressed when ENV=production
 * - warn/error: always emitted
 *
 * Usage:  import { logger } from '../_shared/logger.ts'
 *         logger.debug('[my-fn] processing', data);
 */

const isProduction = Deno.env.get('ENV') === 'production';

export const logger = {
  /** Dev/staging only — suppressed in production */
  debug: (...args: unknown[]) => {
    if (!isProduction) {
      console.log(...args);
    }
  },

  /** Dev/staging only — suppressed in production */
  info: (...args: unknown[]) => {
    if (!isProduction) {
      console.info(...args);
    }
  },

  /** Always emitted */
  warn: (...args: unknown[]) => {
    console.warn(...args);
  },

  /** Always emitted */
  error: (...args: unknown[]) => {
    console.error(...args);
  },
};
