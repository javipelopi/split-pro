import { db } from '~/server/db';

/**
 * Schedules pg_cron jobs via Prisma's safe tagged-template `$executeRaw` /
 * `$queryRaw` helpers. We deliberately do NOT use `$$`-dollar-quoted strings:
 * Prisma's query engine pre-scans SQL looking for `$1, $2, ...` placeholders
 * and doesn't reliably recognize `$$...$$` dollar-quoted literals, which
 * caused the cron.schedule calls to arrive at Postgres with malformed
 * arguments ("function cron.schedule(unknown, unknown, unknown) does not
 * exist"). Instead we build the command text with Postgres's `format(..., %L, ...)`
 * so the literal interpolation happens on the server, and we add explicit
 * `::text` casts on every argument so the cron.schedule overload resolves
 * unambiguously.
 */

export const createRecurringDeleteBankCacheJob = (cronExpression: string, interval: string) =>
  db.$executeRaw`
    SELECT cron.schedule(
      'cleanup_cached_bank_data'::text,
      ${cronExpression}::text,
      format(
        'DELETE FROM "CachedBankData" WHERE "lastFetched" < NOW() - INTERVAL %L; DELETE FROM "CachedCurrencyRate" WHERE "lastFetched" < NOW() - INTERVAL %L;',
        ${interval}::text,
        ${interval}::text
      )
    )
  `;

export const createRecurringExpenseJob = (expenseId: string, cronExpression: string) =>
  db.$queryRaw<[{ schedule: bigint }]>`
    SELECT cron.schedule(
      ${expenseId}::text,
      ${cronExpression}::text,
      format('SELECT duplicate_expense_with_participants(%L::UUID);', ${expenseId}::text)
    )
  `;
