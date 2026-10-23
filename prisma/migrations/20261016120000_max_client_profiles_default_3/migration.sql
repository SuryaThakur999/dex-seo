-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "maxClientProfiles" SET DEFAULT 3;

-- Data migration: existing customers get the new 3-profile ceiling too, not just new signups.
UPDATE "Customer" SET "maxClientProfiles" = 3 WHERE "maxClientProfiles" < 3;
