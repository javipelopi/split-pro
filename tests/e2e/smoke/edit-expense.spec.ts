import { expect, test } from '@playwright/test';

import { loadSeededData } from '../fixtures';

test('edit expense page renders without crashing', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  const { expenseId } = loadSeededData();

  await page.goto(`/add?expenseId=${expenseId}`);

  await expect(page).not.toHaveURL(/\/auth\/signin/);

  const description = page.getByPlaceholder('Enter description');
  await expect(description).toBeVisible();
  await expect(description).toHaveValue('E2E Smoke Expense');

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});
