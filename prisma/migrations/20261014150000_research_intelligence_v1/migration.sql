-- CreateTable
CREATE TABLE "ResearchJob" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "websiteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'resolve_identity',
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultSummary" JSONB,
    "error" TEXT,
    "tokenCost" INTEGER NOT NULL DEFAULT 0,
    "agentReachVersion" TEXT,

    CONSTRAINT "ResearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchLogLine" (
    "id" TEXT NOT NULL,
    "researchJobId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchLogLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "researchJobId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excerpt" TEXT NOT NULL,
    "language" TEXT,
    "sourceType" TEXT NOT NULL,
    "observedMetrics" JSONB,
    "entityMatchConfidence" DOUBLE PRECISION NOT NULL,
    "extractionConfidence" DOUBLE PRECISION NOT NULL,
    "primarySource" BOOLEAN NOT NULL DEFAULT false,
    "limitations" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorEntity" (
    "id" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canonicalDomain" TEXT,
    "classification" TEXT NOT NULL,
    "classificationReason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "userConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRecommendation" (
    "id" TEXT NOT NULL,
    "researchJobId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "opportunityType" TEXT NOT NULL,
    "whyNow" TEXT NOT NULL,
    "businessRelevance" TEXT NOT NULL,
    "companyEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "externalEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "competitorEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "angle" TEXT NOT NULL,
    "claimsAllowed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "claimsRequiringVerification" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "differentiationNote" TEXT,
    "confidenceLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRecommendation_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ContentPiece" ADD COLUMN "sourceRecommendationId" TEXT;

-- CreateIndex
CREATE INDEX "ResearchJob_clientProfileId_idx" ON "ResearchJob"("clientProfileId");

-- CreateIndex
CREATE INDEX "ResearchJob_websiteId_idx" ON "ResearchJob"("websiteId");

-- CreateIndex
CREATE INDEX "ResearchLogLine_researchJobId_idx" ON "ResearchLogLine"("researchJobId");

-- CreateIndex
CREATE INDEX "EvidenceItem_researchJobId_idx" ON "EvidenceItem"("researchJobId");

-- CreateIndex
CREATE INDEX "EvidenceItem_canonicalUrl_idx" ON "EvidenceItem"("canonicalUrl");

-- CreateIndex
CREATE INDEX "CompetitorEntity_clientProfileId_idx" ON "CompetitorEntity"("clientProfileId");

-- CreateIndex
CREATE INDEX "ContentRecommendation_clientProfileId_status_idx" ON "ContentRecommendation"("clientProfileId", "status");

-- CreateIndex
CREATE INDEX "ContentRecommendation_websiteId_status_idx" ON "ContentRecommendation"("websiteId", "status");

-- CreateIndex
CREATE INDEX "ContentPiece_sourceRecommendationId_idx" ON "ContentPiece"("sourceRecommendationId");

-- AddForeignKey
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchLogLine" ADD CONSTRAINT "ResearchLogLine_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "ResearchJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "ResearchJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorEntity" ADD CONSTRAINT "CompetitorEntity_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRecommendation" ADD CONSTRAINT "ContentRecommendation_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "ResearchJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRecommendation" ADD CONSTRAINT "ContentRecommendation_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRecommendation" ADD CONSTRAINT "ContentRecommendation_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPiece" ADD CONSTRAINT "ContentPiece_sourceRecommendationId_fkey" FOREIGN KEY ("sourceRecommendationId") REFERENCES "ContentRecommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
