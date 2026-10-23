-- AlterEnum
ALTER TYPE "ProfileSuggestionField" ADD VALUE 'socialProfiles';

-- DropForeignKey
ALTER TABLE "ResearchJob" DROP CONSTRAINT "ResearchJob_websiteId_fkey";

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "socialProfiles" JSONB NOT NULL DEFAULT '[]';

-- AddForeignKey
ALTER TABLE "ResearchJob" ADD CONSTRAINT "ResearchJob_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE SET NULL ON UPDATE CASCADE;
