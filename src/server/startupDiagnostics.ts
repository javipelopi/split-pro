/**
 * Process-wide registry of startup tasks that run during Next.js
 * instrumentation (migrations, auth env validation, cron job setup, etc).
 *
 * This exists because startup tasks in `src/instrumentation.ts` run inside
 * `setTimeout(..., 10_000)` with `.catch(console.error)`, so failures are
 * otherwise invisible — the app boots, the background task fails silently,
 * nothing surfaces. Recording each task here lets `/api/health` expose the
 * real state so smoke tests can catch these failures before they reach
 * production.
 *
 * The state is stored on `globalThis` because Next.js can bundle
 * `instrumentation.ts` and API route handlers into separate chunks — each
 * chunk then gets its own copy of any module-scoped state, which means a
 * plain `const checks = new Map()` here would be two disjoint Maps: one
 * written by instrumentation, one read by the API route. Pinning the Map
 * on `globalThis` guarantees both chunks see the same instance.
 */

export type CheckStatus = 'pending' | 'ok' | 'failed' | 'skipped';

export interface StartupCheck {
  name: string;
  status: CheckStatus;
  message?: string;
  /** ISO timestamp of the last status transition. */
  updatedAt: string;
}

interface StartupDiagnosticsGlobal {
  __splitproStartupChecks?: Map<string, StartupCheck>;
}

const getChecksMap = (): Map<string, StartupCheck> => {
  const g = globalThis as StartupDiagnosticsGlobal;
  if (!g.__splitproStartupChecks) {
    g.__splitproStartupChecks = new Map<string, StartupCheck>();
  }
  return g.__splitproStartupChecks;
};

export const recordStartupCheck = (name: string, status: CheckStatus, message?: string): void => {
  getChecksMap().set(name, {
    name,
    status,
    message,
    updatedAt: new Date().toISOString(),
  });
};

export const getStartupDiagnostics = (): StartupCheck[] =>
  [...getChecksMap().values()].sort((a, b) => a.name.localeCompare(b.name));

export const isHealthy = (): boolean =>
  [...getChecksMap().values()].every((c) => 'failed' !== c.status);
