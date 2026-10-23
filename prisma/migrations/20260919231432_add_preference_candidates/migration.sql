-- CreateTable
CREATE TABLE "PreferenceCandidate" (
    "id" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "originalProposedPhrase" TEXT NOT NULL,
    "customerEditedPhrase" TEXT,
    "rationale" TEXT NOT NULL,
    "evidenceEntryIds" TEXT[],
    "evidenceExcerpts" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "supersededById" TEXT,
    "sourceFingerprint" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PreferenceCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceCandidateCheck" (
    "id" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "lastFingerprint" TEXT NOT NULL,
    "lastOutcome" TEXT NOT NULL,
    "lastCandidateId" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreferenceCandidateCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceCandidateCheck_websiteId_clientProfileId_targetFi_key" ON "PreferenceCandidateCheck"("websiteId", "clientProfileId", "targetField");

-- AddForeignKey
ALTER TABLE "PreferenceCandidate" ADD CONSTRAINT "PreferenceCandidate_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceCandidate" ADD CONSTRAINT "PreferenceCandidate_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceCandidateCheck" ADD CONSTRAINT "PreferenceCandidateCheck_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceCandidateCheck" ADD CONSTRAINT "PreferenceCandidateCheck_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
