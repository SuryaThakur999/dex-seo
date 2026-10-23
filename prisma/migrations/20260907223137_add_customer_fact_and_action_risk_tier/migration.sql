-- CreateEnum
CREATE TYPE "RiskTier" AS ENUM ('low', 'medium', 'high');

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "policyVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "riskTier" "RiskTier" NOT NULL DEFAULT 'low';

-- CreateTable
CREATE TABLE "CustomerFact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFact_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CustomerFact" ADD CONSTRAINT "CustomerFact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
