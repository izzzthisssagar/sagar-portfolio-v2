-- Backs the retryable contact-notification feature (POST /admin/messages/:id/retry-notification):
-- an atomic conditional UPDATE on this column is how the retry claim is taken, so two concurrent
-- retry requests for the same message can never both send. NULL means no retry is in-flight; a
-- non-NULL value older than the claim TTL is treated as abandoned (e.g. the process crashed
-- mid-attempt) and can be reclaimed.
ALTER TABLE "ContactMessage" ADD COLUMN "retryClaimedAt" TIMESTAMP(3);
