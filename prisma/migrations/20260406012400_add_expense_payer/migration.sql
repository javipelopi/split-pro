-- CreateTable
CREATE TABLE "public"."ExpensePayer" (
    "userId" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "expenseId" UUID NOT NULL,

    CONSTRAINT "ExpensePayer_pkey" PRIMARY KEY ("expenseId","userId")
);

-- AddForeignKey
ALTER TABLE "public"."ExpensePayer" ADD CONSTRAINT "ExpensePayer_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "public"."Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpensePayer" ADD CONSTRAINT "ExpensePayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Populate ExpensePayer from existing Expense.paidBy data
-- Each existing expense gets one payer entry: the user in paidBy with the full amount
INSERT INTO "public"."ExpensePayer" ("expenseId", "userId", "amount")
SELECT "id", "paidBy", "amount"
FROM "public"."Expense"
WHERE "deletedAt" IS NULL;

-- Also populate for soft-deleted expenses so historical data is complete
INSERT INTO "public"."ExpensePayer" ("expenseId", "userId", "amount")
SELECT "id", "paidBy", "amount"
FROM "public"."Expense"
WHERE "deletedAt" IS NOT NULL
ON CONFLICT ("expenseId", "userId") DO NOTHING;

-- Drop and recreate the BalanceView to use ExpensePayer with proportional allocation
DROP VIEW IF EXISTS "public"."BalanceView";

CREATE VIEW "public"."BalanceView" AS
WITH
    "ParticipantShares" AS (
        -- Derive each participant's raw share from their net position and payment
        -- share = amountPaid - netPosition (where netPosition = amountPaid - share)
        SELECT
            ep."expenseId",
            ep."userId",
            COALESCE(epr."amount", 0) - ep."amount" AS "share_amount"
        FROM "public"."ExpenseParticipant" AS ep
        LEFT JOIN "public"."ExpensePayer" AS epr
            ON ep."expenseId" = epr."expenseId" AND ep."userId" = epr."userId"
    ),
    "BaseBalance" AS (
        SELECT
            LEAST(ps."userId", epr."userId") AS "user_id_A",
            GREATEST(ps."userId", epr."userId") AS "user_id_B",
            e."groupId",
            e.currency,
            SUM(
                CASE WHEN e."amount" != 0 THEN
                    (ps."share_amount" * epr."amount") / e."amount"
                    * (CASE WHEN ps."userId" < epr."userId" THEN -1 ELSE 1 END)
                ELSE 0 END
            ) AS "net_amount",
            MIN(e."createdAt") AS "createdAt",
            MAX(e."updatedAt") AS "updatedAt"
        FROM "ParticipantShares" ps
        JOIN "public"."Expense" AS e ON ps."expenseId" = e."id"
        JOIN "public"."ExpensePayer" AS epr ON ps."expenseId" = epr."expenseId"
        WHERE
            ps."userId" != epr."userId"
            AND e."deletedAt" IS NULL
        GROUP BY
            "user_id_A",
            "user_id_B",
            e."groupId",
            e.currency
    )
SELECT
    "user_id_A" AS "userId",
    "user_id_B" AS "friendId",
    "groupId",
    currency,
    "net_amount" AS amount,
    "createdAt",
    "updatedAt"
FROM "BaseBalance"
UNION ALL
SELECT
    "user_id_B" AS "userId",
    "user_id_A" AS "friendId",
    "groupId",
    currency,
    -("net_amount") AS amount,
    "createdAt",
    "updatedAt"
FROM "BaseBalance";

-- Update get_balance_at_date function to use ExpensePayer
CREATE OR REPLACE FUNCTION public.get_balance_at_date(before_date TIMESTAMP WITH TIME ZONE)
RETURNS TABLE (
    "userId" INT,
    "friendId" INT,
    "groupId" INT,
    currency TEXT,
    amount BIGINT,
    "createdAt" TIMESTAMP,
    "updatedAt" TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    WITH "ParticipantShares" AS (
        SELECT
            ep."expenseId",
            ep."userId",
            COALESCE(epr."amount", 0) - ep."amount" AS "share_amount"
        FROM "public"."ExpenseParticipant" AS ep
        LEFT JOIN "public"."ExpensePayer" AS epr
            ON ep."expenseId" = epr."expenseId" AND ep."userId" = epr."userId"
    ),
    "BaseBalance" AS (
        SELECT
            LEAST(ps."userId", epr."userId") AS "user_id_A",
            GREATEST(ps."userId", epr."userId") AS "user_id_B",
            e."groupId" AS grp_id,
            e.currency AS curr,
            SUM(
                CASE WHEN e."amount" != 0 THEN
                    (ps."share_amount" * epr."amount") / e."amount"
                    * (CASE WHEN ps."userId" < epr."userId" THEN -1 ELSE 1 END)
                ELSE 0 END
            )::BIGINT AS "net_amount",
            MIN(e."createdAt") AS created,
            MAX(e."updatedAt") AS updated
        FROM "ParticipantShares" ps
        JOIN "public"."Expense" AS e ON ps."expenseId" = e."id"
        JOIN "public"."ExpensePayer" AS epr ON ps."expenseId" = epr."expenseId"
        WHERE
            ps."userId" != epr."userId"
            AND e."deletedAt" IS NULL
            AND e."createdAt" < before_date
        GROUP BY "user_id_A", "user_id_B", e."groupId", e.currency
    )
    SELECT "user_id_A", "user_id_B", grp_id, curr, "net_amount", created, updated
    FROM "BaseBalance"
    UNION ALL
    SELECT "user_id_B", "user_id_A", grp_id, curr, -"net_amount", created, updated
    FROM "BaseBalance";
END;
$$ LANGUAGE plpgsql STABLE;

-- Update auto_unhide_friend trigger to use ExpensePayer instead of Expense.paidBy
CREATE OR REPLACE FUNCTION public.auto_unhide_friend()
RETURNS TRIGGER AS $$
DECLARE
    payer_record RECORD;
BEGIN
    -- For each payer of this expense, unhide the friend relationship
    FOR payer_record IN
        SELECT epr."userId" as payer_id
        FROM "ExpensePayer" epr
        WHERE epr."expenseId" = NEW."expenseId"
    LOOP
        -- Unhide payer from participant's hidden list
        UPDATE "User"
        SET "hiddenFriendIds" = array_remove("hiddenFriendIds", payer_record.payer_id)
        WHERE id = NEW."userId"
        AND "hiddenFriendIds" @> ARRAY[payer_record.payer_id];

        -- Unhide participant from payer's hidden list
        UPDATE "User"
        SET "hiddenFriendIds" = array_remove("hiddenFriendIds", NEW."userId")
        WHERE id = payer_record.payer_id
        AND "hiddenFriendIds" @> ARRAY[NEW."userId"];
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
