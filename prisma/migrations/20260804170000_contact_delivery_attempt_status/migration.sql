-- Replace the boolean "success" outcome with an explicit tri-state status. Attempt rows are now
-- reserved (status=PENDING) *before* the real SMTP send happens, then finalized to
-- SUCCEEDED/FAILED afterward — a real send can never occur without an already-persisted row
-- claiming its slot, closing the window where a real send could happen with no corresponding row.
-- Existing rows all represent already-finalized real sends recorded under the old model, so the
-- backfill is unambiguous.
CREATE TYPE "ContactDeliveryAttemptStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "ContactDeliveryAttempt" ADD COLUMN "status" "ContactDeliveryAttemptStatus";

UPDATE "ContactDeliveryAttempt"
SET "status" = (CASE WHEN "success" THEN 'SUCCEEDED' ELSE 'FAILED' END)::"ContactDeliveryAttemptStatus";

ALTER TABLE "ContactDeliveryAttempt" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "ContactDeliveryAttempt" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "ContactDeliveryAttempt" DROP COLUMN "success";
