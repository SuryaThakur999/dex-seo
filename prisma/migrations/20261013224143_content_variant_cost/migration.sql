-- CreateTable
CREATE TABLE "ContentVariant" (
    "id" TEXT NOT NULL,
    "contentPieceId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "angle" TEXT NOT NULL,
    "draftContent" JSONB NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "failureReason" TEXT,
    "critique" JSONB,
    "tokenCost" INTEGER NOT NULL DEFAULT 0,
    "proofChecks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentVariant_contentPieceId_idx" ON "ContentVariant"("contentPieceId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVariant_contentPieceId_index_key" ON "ContentVariant"("contentPieceId", "index");

-- AddForeignKey
ALTER TABLE "ContentVariant" ADD CONSTRAINT "ContentVariant_contentPieceId_fkey" FOREIGN KEY ("contentPieceId") REFERENCES "ContentPiece"("id") ON DELETE CASCADE ON UPDATE CASCADE;
