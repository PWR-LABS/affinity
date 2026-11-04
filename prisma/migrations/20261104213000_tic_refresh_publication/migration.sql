-- Idempotent adoption of the publisher ledger installed during authorized local setup.
CREATE TABLE IF NOT EXISTS "TicRefreshPublication" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "stableKey" TEXT NOT NULL,
  "fileId" TEXT NOT NULL UNIQUE REFERENCES "TicFile"("id") ON DELETE CASCADE,
  "sourceDate" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "receiptPath" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "TicRefreshPublication_stableKey" ON "TicRefreshPublication"("stableKey", "sourceDate");
