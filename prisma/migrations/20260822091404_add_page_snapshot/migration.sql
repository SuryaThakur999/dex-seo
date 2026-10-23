-- CreateTable
CREATE TABLE "PageSnapshot" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageSnapshot_customerId_pageUrl_key" ON "PageSnapshot"("customerId", "pageUrl");

-- AddForeignKey
ALTER TABLE "PageSnapshot" ADD CONSTRAINT "PageSnapshot_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
