-- Backfill gscPropertyUrl for customers who already completed Search Console
-- property selection under the old design (before select-site wrote the
-- verified property into gscPropertyUrl instead of overwriting url).
-- Without this, every connected row would go from hasResolvedGsc=true to
-- false on deploy and silently fall back to a public crawl of `url`, which
-- for these rows may hold a non-crawlable GSC property identifier rather
-- than a real URL.
UPDATE "Website" SET "gscPropertyUrl" = "url" WHERE "gscRefreshToken" IS NOT NULL AND "url" <> 'https://example-pending-setup.com' AND "gscPropertyUrl" IS NULL;
