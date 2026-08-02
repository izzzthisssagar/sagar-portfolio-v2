-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "githubUrl" TEXT,
ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "liveUrl" TEXT;
