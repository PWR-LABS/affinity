-- Nullable, additive accounting fields. Historical reservations have unknown usage.
ALTER TABLE "GuruReservation"
  ADD COLUMN IF NOT EXISTS "usageModel" TEXT,
  ADD COLUMN IF NOT EXISTS "usageInputTokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "usageCachedInputTokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "usageCacheWriteInputTokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "usageOutputTokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "usageReasoningTokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "usageEstimatedCostPicoUsd" BIGINT;
