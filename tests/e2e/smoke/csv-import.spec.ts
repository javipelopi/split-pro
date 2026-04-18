import { expect, test } from '@playwright/test';

test('csv import page renders and accepts a file upload', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/import-csv');
  await expect(page).not.toHaveURL(/\/auth\/signin/);

  await expect(page.getByRole('heading', { name: 'Upload CSV file' })).toBeVisible();

  const csv = `Date,Description,Amount,Currency
2024-01-15,Lunch,12.34,USD
2024-01-16,Coffee,4.50,USD
`;

  await page.setInputFiles('input[type="file"]', {
    name: 'smoke.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf-8'),
  });

  await expect(page.getByText(/\b2 rows\b/)).toBeVisible();

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});
