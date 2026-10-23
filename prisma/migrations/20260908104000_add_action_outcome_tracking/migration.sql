-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "baselineCapturedAt" TIMESTAMP(3),
ADD COLUMN     "baselinePerformance" JSONB,
ADD COLUMN     "outcomeMeasuredAt" TIMESTAMP(3),
ADD COLUMN     "outcomePerformance" JSONB;
