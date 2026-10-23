-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "scanJobId" TEXT,
    "pageUrl" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL DEFAULT 'v1',
    "severity" "FindingSeverity" NOT NULL,
    "confidence" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "limitations" TEXT,
    "suggestedAction" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Finding_websiteId_idx" ON "Finding"("websiteId");

-- CreateIndex
CREATE INDEX "Finding_scanJobId_idx" ON "Finding"("scanJobId");

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
