-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('pending', 'approved', 'edited', 'rejected');

-- CreateEnum
CREATE TYPE "ProofOutcome" AS ENUM ('pass', 'flag', 'block');

-- AlterTable: Action.status, String -> ActionStatus enum, existing values match member names exactly
ALTER TABLE "Action" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Action" ALTER COLUMN "status" TYPE "ActionStatus" USING ("status"::"ActionStatus");
ALTER TABLE "Action" ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable: GuardResult.outcome, String -> ProofOutcome enum, existing values match member names exactly
ALTER TABLE "GuardResult" ALTER COLUMN "outcome" TYPE "ProofOutcome" USING ("outcome"::"ProofOutcome");
