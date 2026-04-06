import type { NextApiRequest, NextApiResponse } from 'next';

import { getStartupDiagnostics, isHealthy } from '~/server/startupDiagnostics';

/**
 * Liveness + startup diagnostics endpoint.
 *
 * Returns 200 if every recorded startup task succeeded (or was skipped), and
 * 503 if any task is in the `failed` state. `pending` tasks don't flip the
 * status — smoke tests are expected to wait until nothing is pending.
 *
 * Response shape:
 * {
 *   "status": "ok" | "degraded",
 *   "checks": [
 *     { "name": "migrations", "status": "ok", "updatedAt": "..." },
 *     { "name": "cron:bank-cache", "status": "failed", "message": "...", "updatedAt": "..." },
 *     ...
 *   ]
 * }
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const checks = getStartupDiagnostics();
  const healthy = isHealthy();
  res.setHeader('Cache-Control', 'no-store');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks,
  });
}
