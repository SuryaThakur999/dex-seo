-- Milestone B: Workspace -> ClientProfile -> Website ownership hierarchy.
-- Hand-written (not `prisma migrate dev` output) because it backfills real
-- data from the columns it drops, which Prisma's own diff tool cannot do.

-- 1. New enums
CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'editor', 'reviewer');
CREATE TYPE "WebsiteStatus" AS ENUM ('active', 'archived');

-- 2. New tables
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientProfile" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessDescription" TEXT,
    "audience" TEXT,
    "markets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "brandVoice" TEXT,
    "approvedClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "restrictedWording" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "maxWebsites" INTEGER NOT NULL DEFAULT 3,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Website" (
    "id" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedHost" TEXT NOT NULL,
    "status" "WebsiteStatus" NOT NULL DEFAULT 'active',
    "gscRefreshToken" TEXT,
    "shopifyShopDomain" TEXT,
    "shopifyAccessToken" TEXT,
    "autoExecuteEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);

-- 3. Customer gains workspace-entitlement fields (site-connection fields are
-- dropped from here at the end, once backfilled onto Website below).
ALTER TABLE "Customer" ADD COLUMN "maxClientProfiles" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Customer" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. Backfill: one owner membership + one default client profile + one
-- website per existing Customer, carrying over its real connection data.
INSERT INTO "WorkspaceMember" ("id", "customerId", "clerkUserId", "role", "createdAt")
SELECT gen_random_uuid()::text, "id", "clerkUserId", 'owner', CURRENT_TIMESTAMP
FROM "Customer";

INSERT INTO "ClientProfile" ("id", "customerId", "name", "isDefault", "createdAt")
SELECT gen_random_uuid()::text, "id", 'Default', true, CURRENT_TIMESTAMP
FROM "Customer";

INSERT INTO "Website" (
    "id", "clientProfileId", "url", "normalizedHost", "status",
    "gscRefreshToken", "shopifyShopDomain", "shopifyAccessToken",
    "autoExecuteEnabled", "createdAt"
)
SELECT
    gen_random_uuid()::text,
    cp."id",
    c."websiteUrl",
    lower(regexp_replace(regexp_replace(c."websiteUrl", '^https?://', ''), '^www\.', '')),
    'active',
    c."gscRefreshToken",
    c."shopifyShopDomain",
    c."shopifyAccessToken",
    c."autoExecuteEnabled",
    CURRENT_TIMESTAMP
FROM "Customer" c
JOIN "ClientProfile" cp ON cp."customerId" = c."id" AND cp."isDefault" = true;

-- 5. Action: add websiteId, backfill via the customer's one default website
-- (safe 1:1 mapping since every existing Customer had exactly one site).
ALTER TABLE "Action" ADD COLUMN "websiteId" TEXT;
UPDATE "Action" a
SET "websiteId" = w."id"
FROM "Website" w
JOIN "ClientProfile" cp ON cp."id" = w."clientProfileId"
WHERE cp."customerId" = a."customerId";
ALTER TABLE "Action" ALTER COLUMN "websiteId" SET NOT NULL;
ALTER TABLE "Action" ADD CONSTRAINT "Action_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. ScanJob: same pattern.
ALTER TABLE "ScanJob" ADD COLUMN "websiteId" TEXT;
UPDATE "ScanJob" s
SET "websiteId" = w."id"
FROM "Website" w
JOIN "ClientProfile" cp ON cp."id" = w."clientProfileId"
WHERE cp."customerId" = s."customerId";
ALTER TABLE "ScanJob" ALTER COLUMN "websiteId" SET NOT NULL;
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. PageSnapshot: same pattern, plus swap its unique constraint from
-- (customerId, pageUrl) to (websiteId, pageUrl).
ALTER TABLE "PageSnapshot" ADD COLUMN "websiteId" TEXT;
UPDATE "PageSnapshot" p
SET "websiteId" = w."id"
FROM "Website" w
JOIN "ClientProfile" cp ON cp."id" = w."clientProfileId"
WHERE cp."customerId" = p."customerId";
ALTER TABLE "PageSnapshot" ALTER COLUMN "websiteId" SET NOT NULL;
ALTER TABLE "PageSnapshot" ADD CONSTRAINT "PageSnapshot_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX IF EXISTS "PageSnapshot_customerId_pageUrl_key";
ALTER TABLE "PageSnapshot" ADD CONSTRAINT "PageSnapshot_websiteId_pageUrl_key" UNIQUE ("websiteId", "pageUrl");

-- 8. Now safe to drop the old single-site columns from Customer.
ALTER TABLE "Customer" DROP COLUMN "websiteUrl";
ALTER TABLE "Customer" DROP COLUMN "gscRefreshToken";
ALTER TABLE "Customer" DROP COLUMN "shopifyShopDomain";
ALTER TABLE "Customer" DROP COLUMN "shopifyAccessToken";
ALTER TABLE "Customer" DROP COLUMN "autoExecuteEnabled";

-- 9. Foreign keys for the new tables + entitlement identity constraints.
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_customerId_clerkUserId_key" UNIQUE ("customerId", "clerkUserId");

ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Website" ADD CONSTRAINT "Website_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Website" ADD CONSTRAINT "Website_clientProfileId_normalizedHost_key" UNIQUE ("clientProfileId", "normalizedHost");
