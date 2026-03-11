import { test } from '@playwright/test';
import { percySnapshot } from '@percy/playwright';

const BASE_URL = process.env.TEST_URL ?? 'http://localhost:5173';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE_URL}/auth`);
  await page.fill('[name=email]', process.env.TEST_EMAIL ?? '');
  await page.fill('[name=password]', process.env.TEST_PASSWORD ?? '');
  await page.click('[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
});

// ─── DASHBOARD ───────────────────────────────────────
test('01 - Dashboard', async ({ page }) => {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '01 - Dashboard', { widths: [1440, 768, 375] });
});

// ─── UPLOAD ──────────────────────────────────────────
test('02 - Upload Page', async ({ page }) => {
  await page.goto(`${BASE_URL}/upload`);
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '02 - Upload Page', { widths: [1440, 768, 375] });
});

// ─── SETTLEMENTS ─────────────────────────────────────
test('03 - Settlements - All', async ({ page }) => {
  await page.goto(`${BASE_URL}/settlements`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '03 - Settlements - All', { widths: [1440, 768, 375] });
});

test('04 - Settlements - Amazon AU', async ({ page }) => {
  await page.goto(`${BASE_URL}/settlements`);
  await page.waitForLoadState('networkidle');
  await page.getByText('Amazon AU').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '04 - Settlements - Amazon AU', { widths: [1440] });
});

test('05 - Settlements - Shopify Payments', async ({ page }) => {
  await page.goto(`${BASE_URL}/settlements`);
  await page.getByText('Shopify Payments').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '05 - Settlements - Shopify Payments', { widths: [1440] });
});

test('06 - Settlements - BigW', async ({ page }) => {
  await page.goto(`${BASE_URL}/settlements`);
  await page.getByText('Big W').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '06 - Settlements - BigW', { widths: [1440] });
});

test('07 - Settlements - MyDeal', async ({ page }) => {
  await page.goto(`${BASE_URL}/settlements`);
  await page.getByText('MyDeal').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '07 - Settlements - MyDeal', { widths: [1440] });
});

test('08 - Settlements - Everyday Market', async ({ page }) => {
  await page.goto(`${BASE_URL}/settlements`);
  await page.getByText('everyday_market').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '08 - Settlements - Everyday Market', { widths: [1440] });
});

test('09 - Settlements - Kogan', async ({ page }) => {
  await page.goto(`${BASE_URL}/settlements`);
  await page.getByText('Kogan').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '09 - Settlements - Kogan Empty State', { widths: [1440] });
});

test('10 - Settlements - Reconciliation Hub', async ({ page }) => {
  await page.goto(`${BASE_URL}/settlements`);
  await page.getByText('Reconciliation').click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '10 - Settlements - Reconciliation Hub', { widths: [1440] });
});

// ─── INSIGHTS ────────────────────────────────────────
test('11 - Insights', async ({ page }) => {
  await page.goto(`${BASE_URL}/insights`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await percySnapshot(page, '11 - Insights', { widths: [1440, 768, 375] });
});

// ─── SETTINGS ────────────────────────────────────────
test('12 - Settings', async ({ page }) => {
  await page.goto(`${BASE_URL}/settings`);
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '12 - Settings', { widths: [1440, 768, 375] });
});

test('13 - Settings - Sales Channels', async ({ page }) => {
  await page.goto(`${BASE_URL}/settings`);
  await page.getByText('Sales Channels').click();
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '13 - Settings - Sales Channels', { widths: [1440] });
});

test('14 - Settings - Reconciliation', async ({ page }) => {
  await page.goto(`${BASE_URL}/settings`);
  await page.getByText('Reconciliation').click();
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '14 - Settings - Reconciliation', { widths: [1440] });
});

// ─── ADMIN ───────────────────────────────────────────
test('15 - Admin', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin`);
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '15 - Admin', { widths: [1440] });
});

test('16 - Admin - Bug Reports', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin`);
  await page.getByText('Bug Reports').click();
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '16 - Admin - Bug Reports', { widths: [1440] });
});

test('17 - Admin - Data Integrity', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin`);
  await page.getByText('Data Integrity').click();
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '17 - Admin - Data Integrity', { widths: [1440] });
});

test('18 - Admin - Pre-Launch Checklist', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin`);
  await page.getByText('Pre-Launch').click();
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '18 - Admin - Pre-Launch Checklist', { widths: [1440] });
});

// ─── PUBLIC PAGES ─────────────────────────────────────
test('19 - Plans Page', async ({ page }) => {
  await page.goto(`${BASE_URL}/plans`);
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '19 - Plans Page', { widths: [1440, 768, 375] });
});

test('20 - Homepage', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, '20 - Homepage', { widths: [1440, 768, 375] });
});
