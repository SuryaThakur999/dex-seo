ALTER TABLE "ContentPiece"
ADD COLUMN "websiteId" TEXT,
ADD COLUMN "sourceFindingId" TEXT,
ADD COLUMN "evidence" JSONB;

UPDATE "ContentPiece" AS content
SET "websiteId" = action."websiteId"
FROM "Action" AS action
WHERE content."sourceActionId" IS NOT NULL
AND content."sourceActionId" = action."id";

CREATE INDEX "ContentPiece_websiteId_idx" ON "ContentPiece"("websiteId");
CREATE INDEX "ContentPiece_sourceFindingId_idx" ON "ContentPiece"("sourceFindingId");

ALTER TABLE "ContentPiece" ADD CONSTRAINT "ContentPiece_websiteId_fkey"
FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentPiece" ADD CONSTRAINT "ContentPiece_sourceFindingId_fkey"
FOREIGN KEY ("sourceFindingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
