-- Aggregate reservations only. No transcript, household, patient or IP fields.
CREATE TABLE "GuruReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reservedMicro" INTEGER NOT NULL CHECK ("reservedMicro" > 0),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "GuruReservation_createdAt_idx" ON "GuruReservation" ("createdAt");
