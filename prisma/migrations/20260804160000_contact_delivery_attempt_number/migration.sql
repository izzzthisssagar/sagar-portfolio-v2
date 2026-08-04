-- Every real ContactNotificationAdapter.send() call now gets its own ContactDeliveryAttempt row
-- (see contact.service.ts) — attemptNumber is the monotonically increasing, per-ContactMessage
-- sequence that makes "how many real sends has this message had" a plain row count instead of a
-- single row silently summarizing several sends. Nullable first, then backfilled, then set
-- NOT NULL: safe against any pre-existing rows (this app has no real production data yet, but a
-- non-empty local/staging database must not break on this migration).
-- AlterTable
ALTER TABLE "ContactDeliveryAttempt" ADD COLUMN "attemptNumber" INTEGER;

-- Backfill: assign each ContactMessage's existing attempt rows a sequential number in the order
-- they actually happened.
UPDATE "ContactDeliveryAttempt" AS a
SET "attemptNumber" = ranked.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "contactMessageId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "ContactDeliveryAttempt"
) AS ranked
WHERE a."id" = ranked."id";

-- AlterTable
ALTER TABLE "ContactDeliveryAttempt" ALTER COLUMN "attemptNumber" SET NOT NULL;

-- CreateIndex
-- Database-enforced backstop against two concurrent allocations ever landing on the same
-- attempt number for the same message — application code also serializes real sends via
-- ContactMessage.retryClaimedAt for manual retries, but this constraint is what turns a race
-- into a loud, immediate failure instead of a silently overwritten/duplicated attempt row.
CREATE UNIQUE INDEX "ContactDeliveryAttempt_contactMessageId_attemptNumber_key" ON "ContactDeliveryAttempt"("contactMessageId", "attemptNumber");
