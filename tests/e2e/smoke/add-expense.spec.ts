import { expect, test } from '@playwright/test';

test('add expense page renders without crashing', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/add');

  await expect(page).not.toHaveURL(/\/auth\/signin/);

  await expect(page.getByPlaceholder('Enter description')).toBeVisible();
  await expect(page.getByPlaceholder('Enter amount')).toBeVisible();

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});
