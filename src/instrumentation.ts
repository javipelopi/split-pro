import { env } from './env';
import { recordStartupCheck } from './server/startupDiagnostics';

/**
 * Add things here to be executed during server startup.
 *
 * more details here: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('Registering instrumentation');

    // Run data migrations
    recordStartupCheck('migrations', 'pending');
    const { runMigrations } = await import('./migrations');
    try {
      await runMigrations();
      recordStartupCheck('migrations', 'ok');
    } catch (err) {
      recordStartupCheck('migrations', 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }

    const { validateAuthEnv } = await import('./server/auth');
    try {
      validateAuthEnv();
      recordStartupCheck('auth-env', 'ok');
    } catch (err) {
      recordStartupCheck('auth-env', 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }

    const { checkRecurrenceNotifications } =
      await import('./server/api/services/notificationService');
    console.log('Starting recurrent expense notification checking...');
    setTimeout(checkRecurrenceNotifications, 1000 * 10); // Start after 10 seconds
  }

  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    console.log('Skipping instrumentation on edge runtime');
    return;
  }

  if (env.CLEAR_CACHE_CRON_RULE && env.CACHE_RETENTION_INTERVAL) {
    // Create cron jobs
    console.log('Setting up cron jobs...');
    recordStartupCheck('cron:bank-cache', 'pending');

    const { createRecurringDeleteBankCacheJob } =
      await import('./server/api/services/scheduleService');

    console.log(
      `Creating cron job for cleaning up bank cache ${env.CLEAR_CACHE_CRON_RULE} with interval ${env.CACHE_RETENTION_INTERVAL}`,
    );
    setTimeout(
      () =>
        createRecurringDeleteBankCacheJob(env.CLEAR_CACHE_CRON_RULE!, env.CACHE_RETENTION_INTERVAL!)
          .then(() => {
            recordStartupCheck('cron:bank-cache', 'ok');
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error('Error creating recurring delete bank cache job:', err);
            recordStartupCheck('cron:bank-cache', 'failed', message);
          }),
      1000 * 10,
    );
  } else {
    recordStartupCheck(
      'cron:bank-cache',
      'skipped',
      'CLEAR_CACHE_CRON_RULE or CACHE_RETENTION_INTERVAL not set',
    );
  }
}
