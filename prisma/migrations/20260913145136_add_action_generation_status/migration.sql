-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('succeeded', 'failed');

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "generationError" TEXT,
ADD COLUMN     "generationStatus" "GenerationStatus" NOT NULL DEFAULT 'succeeded';
