import { expect, test } from '@playwright/test';

import { loadSeededData } from '../fixtures';

test('group duplicates tab renders without crashing', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  const { groupId } = loadSeededData();

  await page.goto(`/groups/${groupId}`);
  await expect(page).not.toHaveURL(/\/auth\/signin/);

  await page.getByRole('tab', { name: 'Duplicates' }).click();

  await expect(page.getByText(/no suspected duplicates/i)).toBeVisible();

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});
