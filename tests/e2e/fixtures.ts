import { readFileSync } from 'node:fs';

import { DATA_FILE, type SeededData } from './constants';

function isSeededData(value: unknown): value is SeededData {
  if (!value || typeof value !== 'object') return false;
  const record: Record<string, unknown> = value as Record<string, unknown>;
  return (
    typeof record.userId === 'number' &&
    typeof record.groupId === 'number' &&
    typeof record.expenseId === 'string'
  );
}

export function loadSeededData(): SeededData {
  const raw = readFileSync(DATA_FILE, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!isSeededData(parsed)) {
    throw new Error(`Invalid seeded data at ${DATA_FILE}: ${raw}`);
  }
  return parsed;
}
