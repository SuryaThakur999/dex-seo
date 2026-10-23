-- CreateTable
CREATE TABLE "ScanLogLine" (
    "id" TEXT NOT NULL,
    "scanJobId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanLogLine_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ScanLogLine" ADD CONSTRAINT "ScanLogLine_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
