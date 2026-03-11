

## Percy Workflow Fix — Missing Dependencies

### Root Cause

The test file `tests/visual.spec.ts` imports two packages that are **not in `package.json`**:

1. **`@playwright/test`** — needed for `test`, `page` etc.
2. **`@percy/playwright`** — needed for `percySnapshot()`
3. **`@percy/cli`** — needed for the `percy exec` command

Without these, `npm ci` installs nothing for them, and the test fails immediately with exit code 1.

### Fix

**Add dev dependencies to `package.json`:**
- `@playwright/test`
- `@percy/cli`
- `@percy/playwright`

**Also add a `playwright.config.ts`** at the project root so Playwright knows its configuration (timeout, base URL, etc.) — currently there's none.

### Files to Change

1. **`package.json`** — Add three devDependencies:
   - `"@playwright/test": "^1.49.0"`
   - `"@percy/cli": "^1.29.0"`
   - `"@percy/playwright": "^1.0.6"`

2. **`playwright.config.ts`** (new) — Minimal config:
   - Timeout: 30s per test
   - Use Chromium only
   - Base URL from env

3. **`.github/workflows/percy.yml`** — No port changes needed (8080 is correct per `vite.config.ts`). Only cosmetic: the workflow is already correct.

