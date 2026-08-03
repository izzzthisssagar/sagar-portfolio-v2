-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContactStatus" ADD VALUE 'REPLIED';
ALTER TYPE "ContactStatus" ADD VALUE 'SPAM';

-- AlterTable
ALTER TABLE "ContactMessage" ADD COLUMN     "company" TEXT;

-- CreateTable
CREATE TABLE "ContactDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "contactMessageId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactDeliveryAttempt_contactMessageId_idx" ON "ContactDeliveryAttempt"("contactMessageId");

-- CreateIndex
CREATE INDEX "ContactMessage_status_createdAt_idx" ON "ContactMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContactMessage_email_createdAt_idx" ON "ContactMessage"("email", "createdAt");

-- AddForeignKey
ALTER TABLE "ContactDeliveryAttempt" ADD CONSTRAINT "ContactDeliveryAttempt_contactMessageId_fkey" FOREIGN KEY ("contactMessageId") REFERENCES "ContactMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
