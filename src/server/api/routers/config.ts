import { createTRPCRouter, publicProcedure } from '~/server/api/trpc';
import { env } from '~/env';

export const configRouter = createTRPCRouter({
  getPublicConfig: publicProcedure.query(() => ({
    uploadMaxFileSizeMB: env.UPLOAD_MAX_FILE_SIZE_MB,
    frankfurterUsed: env.CURRENCY_RATE_PROVIDER === 'frankfurter',
  })),
});
