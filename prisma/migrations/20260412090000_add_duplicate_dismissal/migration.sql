-- CreateTable
CREATE TABLE "public"."DuplicateDismissal" (
    "expenseIdA" UUID NOT NULL,
    "expenseIdB" UUID NOT NULL,
    "dismissedBy" INTEGER NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateDismissal_pkey" PRIMARY KEY ("expenseIdA","expenseIdB")
);

-- AddForeignKey
ALTER TABLE "public"."DuplicateDismissal" ADD CONSTRAINT "DuplicateDismissal_expenseIdA_fkey" FOREIGN KEY ("expenseIdA") REFERENCES "public"."Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DuplicateDismissal" ADD CONSTRAINT "DuplicateDismissal_expenseIdB_fkey" FOREIGN KEY ("expenseIdB") REFERENCES "public"."Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DuplicateDismissal" ADD CONSTRAINT "DuplicateDismissal_dismissedBy_fkey" FOREIGN KEY ("dismissedBy") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
