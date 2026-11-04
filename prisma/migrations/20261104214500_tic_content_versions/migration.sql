-- Content versions can share a publisher URL. Existing serving data stays active.
ALTER TABLE "TicFile" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
DROP INDEX IF EXISTS "TicFile_url_key";
CREATE INDEX IF NOT EXISTS "TicFile_url_idx" ON "TicFile"("url");
ALTER TABLE "TicRefreshPublication" ADD COLUMN IF NOT EXISTS "withdrawn" BOOLEAN NOT NULL DEFAULT false;
-- The scoped updater may only change serving activation, not arbitrary file metadata.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='affinity_refresh') THEN
    GRANT UPDATE(withdrawn) ON "TicRefreshPublication" TO affinity_refresh;
    GRANT UPDATE(active) ON "TicFile" TO affinity_refresh;
  END IF;
END $$;
