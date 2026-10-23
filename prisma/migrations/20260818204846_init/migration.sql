-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "gscRefreshToken" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "autoExecuteEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "currentValue" TEXT,
    "draftContent" TEXT NOT NULL,
    "aiDisclosure" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tokenCost" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardResult" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "checksRun" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,

    CONSTRAINT "GuardResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_clerkUserId_key" ON "Customer"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "GuardResult_actionId_key" ON "GuardResult"("actionId");

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardResult" ADD CONSTRAINT "GuardResult_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
