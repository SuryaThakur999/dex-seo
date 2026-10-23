-- CreateTable
CREATE TABLE "PreferenceEvaluation" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "evaluatedPhrase" TEXT NOT NULL,
    "excludedActionIds" TEXT[],
    "supportingCount" INTEGER NOT NULL DEFAULT 0,
    "counterCount" INTEGER NOT NULL DEFAULT 0,
    "neutralCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "decisionRationale" TEXT,
    "evaluatorVersion" TEXT NOT NULL,
    "sourceFingerprint" TEXT,
    "limitations" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PreferenceEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceEvaluationCase" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "evidenceExcerpt" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreferenceEvaluationCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceEvaluation_candidateId_key" ON "PreferenceEvaluation"("candidateId");

-- CreateIndex
CREATE INDEX "PreferenceEvaluation_websiteId_status_idx" ON "PreferenceEvaluation"("websiteId", "status");

-- CreateIndex
CREATE INDEX "PreferenceEvaluationCase_actionId_idx" ON "PreferenceEvaluationCase"("actionId");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceEvaluationCase_evaluationId_actionId_key" ON "PreferenceEvaluationCase"("evaluationId", "actionId");

-- AddForeignKey
ALTER TABLE "PreferenceEvaluation" ADD CONSTRAINT "PreferenceEvaluation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "PreferenceCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceEvaluation" ADD CONSTRAINT "PreferenceEvaluation_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceEvaluation" ADD CONSTRAINT "PreferenceEvaluation_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceEvaluationCase" ADD CONSTRAINT "PreferenceEvaluationCase_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "PreferenceEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
