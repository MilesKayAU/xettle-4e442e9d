import { test, Page } from '@playwright/test';
import { percySnapshot } from '@percy/playwright';

const BASE_URL = process.env.TEST_URL ?? 'http://localhost:8080';
const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '';

async function login(page: Page) {
  await page.goto(`${BASE_URL}/auth`);
  await page.waitForLoadState('networkidle');
  await page.fill('#signin-email', TEST_EMAIL);
  await page.fill('#signin-password', TEST_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

// Helper: click a primary tab by label
async function clickTab(page: Page, label: string) {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
}

// Helper: click a sub-tab by label
async function clickSubTab(page: Page, label: string) {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
}

// ─── PUBLIC PAGES ─────────────────────────────────────
test('01 - Homepage', async ({ page }) => {
  await page.goto(`${BASE_URL}?test_mode=true`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await percySnapshot(page, '01 - Homepage', { widths: [1440, 768, 375] });
});

test('02 - Pricing Page', async ({ page }) => {
  await page.goto(`${BASE_URL}/pricing?test_mode=true`);
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '02 - Pricing Page', { widths: [1440, 768, 375] });
});

// ─── DASHBOARD ───────────────────────────────────────
test('03 - Dashboard', async ({ page }) => {
  await login(page);
  await page.waitForTimeout(2000);
  await percySnapshot(page, '03 - Dashboard', { widths: [1440, 768, 375] });
});

// ─── UPLOAD ──────────────────────────────────────────
test('04 - Upload Page', async ({ page }) => {
  await login(page);
  await clickTab(page, 'Upload');
  await percySnapshot(page, '04 - Upload Page', { widths: [1440, 768, 375] });
});

// ─── SETTLEMENTS ─────────────────────────────────────
test('05 - Settlements - All', async ({ page }) => {
  await login(page);
  await clickTab(page, 'Settlements');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '05 - Settlements - All', { widths: [1440, 768, 375] });
});

test('06 - Settlements - Overview', async ({ page }) => {
  await login(page);
  await clickTab(page, 'Settlements');
  await clickSubTab(page, 'Overview');
  await percySnapshot(page, '06 - Settlements - Overview', { widths: [1440] });
});

test('07 - Settlements - Reconciliation Hub', async ({ page }) => {
  await login(page);
  await clickTab(page, 'Settlements');
  await clickSubTab(page, 'Reconciliation Hub');
  await percySnapshot(page, '07 - Settlements - Reconciliation Hub', { widths: [1440] });
});

// ─── INSIGHTS ────────────────────────────────────────
test('08 - Insights - Overview', async ({ page }) => {
  await login(page);
  await clickTab(page, 'Insights');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '08 - Insights - Overview', { widths: [1440, 768, 375] });
});

test('09 - Insights - Reconciliation', async ({ page }) => {
  await login(page);
  await clickTab(page, 'Insights');
  await clickSubTab(page, 'Reconciliation');
  await percySnapshot(page, '09 - Insights - Reconciliation', { widths: [1440] });
});

test('10 - Insights - Profit Analysis', async ({ page }) => {
  await login(page);
  await clickTab(page, 'Insights');
  await clickSubTab(page, 'Profit Analysis');
  await percySnapshot(page, '10 - Insights - Profit Analysis', { widths: [1440] });
});

test('11 - Insights - SKU Comparison', async ({ page }) => {
  await login(page);
  await clickTab(page, 'Insights');
  await clickSubTab(page, 'SKU Comparison');
  await percySnapshot(page, '11 - Insights - SKU Comparison', { widths: [1440] });
});

// ─── ADMIN ───────────────────────────────────────────
test('12 - Admin', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE_URL}/admin`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await percySnapshot(page, '12 - Admin', { widths: [1440] });
});
