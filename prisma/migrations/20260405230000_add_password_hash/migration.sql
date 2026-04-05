-- AlterTable (idempotent — safe for upgrades from v0.5.0 which may already have this column)
ALTER TABLE "public"."User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
