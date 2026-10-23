-- CreateTable
CREATE TABLE "FeedbackAnalysis" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "summary" TEXT,
    "sourceEditCount" INTEGER NOT NULL,
    "sourceLatestEntryAt" TIMESTAMP(3),
    "sourceFingerprint" TEXT,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackAnalysis_websiteId_key" ON "FeedbackAnalysis"("websiteId");

-- AddForeignKey
ALTER TABLE "FeedbackAnalysis" ADD CONSTRAINT "FeedbackAnalysis_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
