/**
 * CORS Guardrail Tests
 * 
 * Ensures all edge functions use the shared CORS helper and
 * never set Access-Control-Allow-Origin: * directly.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const FUNCTIONS_DIR = path.resolve(__dirname, '../../../supabase/functions');

function getEdgeFunctionDirs(): string[] {
  return fs.readdirSync(FUNCTIONS_DIR).filter((name) => {
    const fullPath = path.join(FUNCTIONS_DIR, name);
    return fs.statSync(fullPath).isDirectory() && name !== '_shared';
  });
}

function readFunctionIndex(funcName: string): string {
  const filePath = path.join(FUNCTIONS_DIR, funcName, 'index.ts');
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

describe('CORS Guardrails', () => {
  const functions = getEdgeFunctionDirs();

  it('should find at least 30 edge functions', () => {
    expect(functions.length).toBeGreaterThanOrEqual(30);
  });

  it.each(functions)('%s must NOT use Access-Control-Allow-Origin: *', (funcName) => {
    const content = readFunctionIndex(funcName);
    if (!content) return; // skip if no index.ts (e.g. test files only)
    
    // Check for wildcard CORS — should never appear
    const wildcardPattern = /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/;
    expect(content).not.toMatch(wildcardPattern);
  });

  it.each(functions)('%s must import from _shared/cors.ts', (funcName) => {
    const content = readFunctionIndex(funcName);
    if (!content) return;
    
    expect(content).toContain('_shared/cors');
  });

  it('shared cors.ts must exist and export getCorsHeaders', () => {
    const sharedPath = path.join(FUNCTIONS_DIR, '_shared', 'cors.ts');
    expect(fs.existsSync(sharedPath)).toBe(true);
    
    const content = fs.readFileSync(sharedPath, 'utf-8');
    expect(content).toContain('export function getCorsHeaders');
    expect(content).toContain('export function handleCorsPreflightResponse');
  });

  it('shared cors.ts must NOT contain wildcard origin', () => {
    const sharedPath = path.join(FUNCTIONS_DIR, '_shared', 'cors.ts');
    const content = fs.readFileSync(sharedPath, 'utf-8');
    expect(content).not.toContain("'*'");
  });
});
