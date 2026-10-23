-- CreateIndex
CREATE INDEX "PreferenceCandidate_websiteId_status_idx" ON "PreferenceCandidate"("websiteId", "status");

-- CreateIndex
CREATE INDEX "PreferenceCandidate_clientProfileId_idx" ON "PreferenceCandidate"("clientProfileId");
