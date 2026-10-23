-- CreateEnum
CREATE TYPE "ProducerKind" AS ENUM ('model', 'deterministic');

-- CreateEnum
CREATE TYPE "FindingAssociationKind" AS ENUM ('causal', 'input_only', 'unavailable');

-- CreateTable
CREATE TABLE "ActionProvenance" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "clientProfileIdAtExecution" TEXT,
    "actionId" TEXT NOT NULL,
    "generationJobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "actionType" TEXT NOT NULL,
    "producerKind" "ProducerKind" NOT NULL,
    "producerVersion" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "requestTemplateVersion" TEXT,
    "findingAssociation" "FindingAssociationKind" NOT NULL,
    "associationReason" TEXT,
    "sourceDescriptor" TEXT,
    "enqueueInputsSnapshot" JSONB NOT NULL,
    "enqueueInputsVersion" TEXT NOT NULL,
    "generatorInputsSnapshot" JSONB NOT NULL,
    "generatorInputsVersion" TEXT NOT NULL,
    "validatorInputsSnapshot" JSONB,
    "validatorInputsVersion" TEXT,
    "inputsCapturedAt" TIMESTAMP(3) NOT NULL,
    "inputsDigest" TEXT NOT NULL,
    "inputsDigestFormat" TEXT NOT NULL DEFAULT 'sha256-hex',
    "checkedBytes" TEXT NOT NULL,
    "checkedBytesSha256" TEXT NOT NULL,
    "validatorKind" TEXT,
    "validatorVersion" TEXT,
    "checkedAt" TIMESTAMP(3),
    "guardOutcome" "ProofOutcome",
    "checksRun" JSONB,
    "reasoning" TEXT,
    "validationFormatVersion" TEXT,
    "policySnapshot" JSONB,
    "policySnapshotVersion" TEXT,
    "policyCapturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionProvenanceFinding" (
    "id" TEXT NOT NULL,
    "actionProvenanceId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "limitations" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionProvenanceFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionProvenance_executionId_key" ON "ActionProvenance"("executionId");

-- CreateIndex
CREATE INDEX "ActionProvenance_customerId_websiteId_createdAt_idx" ON "ActionProvenance"("customerId", "websiteId", "createdAt");

-- CreateIndex
CREATE INDEX "ActionProvenance_actionId_createdAt_idx" ON "ActionProvenance"("actionId", "createdAt");

-- CreateIndex
CREATE INDEX "ActionProvenance_generationJobId_attemptNumber_idx" ON "ActionProvenance"("generationJobId", "attemptNumber");

-- CreateIndex
CREATE INDEX "ActionProvenanceFinding_actionProvenanceId_idx" ON "ActionProvenanceFinding"("actionProvenanceId");

-- CreateIndex
CREATE INDEX "ActionProvenanceFinding_findingId_idx" ON "ActionProvenanceFinding"("findingId");

-- AddForeignKey
ALTER TABLE "ActionProvenance" ADD CONSTRAINT "ActionProvenance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProvenance" ADD CONSTRAINT "ActionProvenance_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProvenance" ADD CONSTRAINT "ActionProvenance_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProvenanceFinding" ADD CONSTRAINT "ActionProvenanceFinding_actionProvenanceId_fkey" FOREIGN KEY ("actionProvenanceId") REFERENCES "ActionProvenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProvenanceFinding" ADD CONSTRAINT "ActionProvenanceFinding_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
