-- Keyed pseudonyms only; never raw addresses, browser tokens or household data.
ALTER TABLE "GuruReservation" ADD COLUMN "visitorHash" TEXT;
ALTER TABLE "GuruReservation" ADD COLUMN "networkHash" TEXT;
CREATE INDEX "GuruReservation_visitorHash_createdAt_idx" ON "GuruReservation" ("visitorHash", "createdAt");
CREATE INDEX "GuruReservation_networkHash_createdAt_idx" ON "GuruReservation" ("networkHash", "createdAt");
