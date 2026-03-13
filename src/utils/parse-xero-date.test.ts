import { describe, it, expect } from 'vitest';
import { parseXeroDate } from './parse-xero-date';

describe('parseXeroDate', () => {
  it('parses ISO date string', () => {
    expect(parseXeroDate('2026-01-15')).toBe('2026-01-15');
  });

  it('parses ISO datetime string, strips time', () => {
    expect(parseXeroDate('2026-01-15T00:00:00')).toBe('2026-01-15');
  });

  it('parses Xero .NET /Date(ms)/ format', () => {
    expect(parseXeroDate('/Date(1700000000000)/')).toBe('2023-11-14');
  });

  it('parses Xero .NET /Date(ms+offset)/ format', () => {
    expect(parseXeroDate('/Date(1700000000000+0000)/')).toBe('2023-11-14');
  });

  it('returns null for garbage input', () => {
    expect(parseXeroDate('not a date')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(parseXeroDate(null)).toBeNull();
    expect(parseXeroDate(undefined)).toBeNull();
  });

  it('returns null for small numeric (not a real timestamp)', () => {
    expect(parseXeroDate('/Date(2026)/')).toBeNull();
  });
});
