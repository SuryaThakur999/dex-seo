-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedByScanJobId" TEXT;

-- CreateIndex
CREATE INDEX "Finding_websiteId_resolvedAt_idx" ON "Finding"("websiteId", "resolvedAt");
