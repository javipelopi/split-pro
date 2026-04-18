import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const STORAGE_STATE = path.join(dirname, '.auth', 'user.json');
export const DATA_FILE = path.join(dirname, '.auth', 'data.json');

export const E2E_USER = {
  name: 'E2E Smoke',
  email: 'e2e-smoke@example.com',
  password: 'e2e-smoke-password-1',
};

// Stable publicId so reruns against a warm database can clean up after
// themselves instead of stacking test groups across runs.
export const E2E_GROUP_PUBLIC_ID = 'e2e-smoke-group-0000000000';

export interface SeededData {
  userId: number;
  groupId: number;
  expenseId: string;
}
