

## Percy Workflow — Install Dependencies Failure

### Root Cause

The "Install dependencies" step (`npm ci`) is failing because:

1. **Lock file mismatch**: The project has `bun.lock` / `bun.lockb` but the CI runs `npm ci`, which strictly requires `package-lock.json` to match `package.json` exactly. Any drift causes `npm ci` to fail.

2. **Missing `@percy/cli`**: The `percy exec` command requires `@percy/cli` to be installed. It's not in `package.json` at all.

3. **Testing packages in wrong section**: `@playwright/test`, `@percy/playwright`, `@testing-library/*`, `jsdom`, and `vitest` are in `dependencies` instead of `devDependencies`.

### Fix

1. **`package.json`** — Move test-only packages to `devDependencies` and add `@percy/cli`:
   - Move to devDependencies: `@percy/playwright`, `@playwright/test`, `@testing-library/jest-dom`, `@testing-library/react`, `jsdom`, `vitest`
   - Add to devDependencies: `@percy/cli: "^1.29.0"`

2. **`.github/workflows/percy.yml`** — Change `npm ci` to `npm install` (more tolerant of lock file drift), OR regenerate `package-lock.json`. The simpler fix is switching to `npm install`:
   ```yaml
   - name: Install dependencies
     run: npm install
   ```

### Files to Change

- **`package.json`** — Reorganize deps, add `@percy/cli`
- **`.github/workflows/percy.yml`** — Use `npm install` instead of `npm ci`

