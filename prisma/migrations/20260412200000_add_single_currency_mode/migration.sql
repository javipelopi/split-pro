-- AlterTable
ALTER TABLE "public"."Group" ADD COLUMN "singleCurrencyMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."Expense" ADD COLUMN "originalAmount" BIGINT;
ALTER TABLE "public"."Expense" ADD COLUMN "originalCurrency" TEXT;
