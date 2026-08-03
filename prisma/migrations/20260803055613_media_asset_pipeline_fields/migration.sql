/*
  Warnings:

  - Added the required column `category` to the `MediaAsset` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MediaCategory" AS ENUM ('IMAGE', 'DOCUMENT');

-- AlterEnum
ALTER TYPE "MediaStatus" ADD VALUE 'ARCHIVED';

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "caption" TEXT,
ADD COLUMN     "category" "MediaCategory" NOT NULL,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "decorative" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "sourceNote" TEXT;

-- CreateIndex
CREATE INDEX "MediaAsset_status_idx" ON "MediaAsset"("status");

-- CreateIndex
CREATE INDEX "MediaAsset_category_idx" ON "MediaAsset"("category");

-- CreateIndex
CREATE INDEX "MediaAsset_sha256_idx" ON "MediaAsset"("sha256");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
