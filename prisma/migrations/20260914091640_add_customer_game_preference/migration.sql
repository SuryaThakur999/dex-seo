-- CreateEnum
CREATE TYPE "GamePreference" AS ENUM ('ask', 'always_game', 'always_watch', 'disabled');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "gamePreference" "GamePreference" NOT NULL DEFAULT 'ask';
