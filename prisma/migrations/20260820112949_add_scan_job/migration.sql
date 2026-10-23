-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultSummary" JSONB,
    "error" TEXT,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
