import { expect, test as setup } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { E2E_USER, STORAGE_STATE } from './constants';

setup('authenticate', async ({ page, request, baseURL }) => {
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });

  const register = await request.post('/api/auth/register', {
    data: {
      name: E2E_USER.name,
      email: E2E_USER.email,
      password: E2E_USER.password,
    },
  });
  expect(
    [201, 409],
    `register returned ${register.status()} at ${baseURL}/api/auth/register`,
  ).toContain(register.status());

  await page.goto('/auth/signin');
  await page.getByLabel(/email/i).fill(E2E_USER.email);
  await page.getByLabel(/password/i).fill(E2E_USER.password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 30_000 }),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);

  await page.context().storageState({ path: STORAGE_STATE });
});
