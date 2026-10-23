-- AlterTable
ALTER TABLE "ContentPiece" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "market" TEXT,
ADD COLUMN     "objective" TEXT,
ADD COLUMN     "proofChecks" JSONB;
