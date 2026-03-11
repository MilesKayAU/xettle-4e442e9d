import { test } from '@playwright/test';
import { percySnapshot } from '@percy/playwright';

const BASE_URL = process.env.TEST_URL ?? 'http://localhost:8080';
const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE_URL}/auth`);
  await page.fill('[name=email]', TEST_EMAIL);
  await page.fill('[name=password]', TEST_PASSWORD);
  await page.click('[type=submit]');
  await page.waitForURL('**/dashboard');
});

const pages = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Upload', path: '/upload' },
  { name: 'Insights', path: '/insights' },
  { name: 'Settings', path: '/settings' },
  { name: 'Plans', path: '/plans' },
  { name: 'Admin', path: '/admin' },
  { name: 'Homepage', path: '/' },
];

for (const p of pages) {
  test(`Screenshot: ${p.name}`, async ({ page }) => {
    await page.goto(`${BASE_URL}${p.path}`);
    await page.waitForLoadState('networkidle');
    await percySnapshot(page, p.name, {
      widths: [1440, 768, 375],
    });
  });
}

// Key UI states
test('Screenshot: Admin - Pre-Launch Checklist', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin`);
  await page.click('text=Pre-Launch');
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, 'Admin - Pre-Launch Checklist');
});

test('Screenshot: Dashboard - Channel Alerts', async ({ page }) => {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle');
  await percySnapshot(page, 'Dashboard - Channel Alerts');
});
