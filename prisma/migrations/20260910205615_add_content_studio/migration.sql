-- CreateEnum
CREATE TYPE "ContentPlatform" AS ENUM ('linkedin', 'instagram', 'facebook', 'x', 'reddit', 'tiktok', 'youtube', 'ugc_brief');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'needs_assets', 'needs_review', 'approved', 'ready_to_publish', 'published', 'failed', 'archived');

-- CreateTable
CREATE TABLE "ContentPiece" (
    "id" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "platform" "ContentPlatform" NOT NULL,
    "topic" TEXT NOT NULL,
    "sourceActionId" TEXT,
    "draftContent" JSONB NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "tokenCost" INTEGER,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ContentPiece_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentPiece_clientProfileId_idx" ON "ContentPiece"("clientProfileId");

-- CreateIndex
CREATE INDEX "ContentPiece_sourceActionId_idx" ON "ContentPiece"("sourceActionId");

-- AddForeignKey
ALTER TABLE "ContentPiece" ADD CONSTRAINT "ContentPiece_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPiece" ADD CONSTRAINT "ContentPiece_sourceActionId_fkey" FOREIGN KEY ("sourceActionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;
