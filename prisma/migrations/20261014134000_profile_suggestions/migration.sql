CREATE TYPE "ProfileSuggestionField" AS ENUM ('businessDescription', 'audience', 'markets', 'languages', 'brandVoice');
CREATE TYPE "ProfileSuggestionStatus" AS ENUM ('suggested', 'accepted', 'rejected');

CREATE UNIQUE INDEX "Website_id_clientProfileId_key" ON "Website"("id", "clientProfileId");

CREATE TABLE "ProfileSuggestion" (
    "id" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "field" "ProfileSuggestionField" NOT NULL,
    "valueJson" JSONB NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceExcerpt" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "status" "ProfileSuggestionStatus" NOT NULL DEFAULT 'suggested',
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ProfileSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfileSuggestion_identity_key" ON "ProfileSuggestion"("identity");
CREATE INDEX "ProfileSuggestion_clientProfileId_status_idx" ON "ProfileSuggestion"("clientProfileId", "status");
CREATE INDEX "ProfileSuggestion_websiteId_status_idx" ON "ProfileSuggestion"("websiteId", "status");

ALTER TABLE "ProfileSuggestion" ADD CONSTRAINT "ProfileSuggestion_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileSuggestion" ADD CONSTRAINT "ProfileSuggestion_websiteId_clientProfileId_fkey" FOREIGN KEY ("websiteId", "clientProfileId") REFERENCES "Website"("id", "clientProfileId") ON DELETE CASCADE ON UPDATE CASCADE;
