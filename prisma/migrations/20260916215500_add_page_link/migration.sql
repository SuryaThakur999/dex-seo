-- CreateTable
CREATE TABLE "PageLink" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "scanJobId" TEXT,
    "fromUrl" TEXT NOT NULL,
    "toUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageLink_websiteId_idx" ON "PageLink"("websiteId");

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
