-- CreateTable
CREATE TABLE "EmployerEin" (
    "id" TEXT NOT NULL,
    "ein" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNorm" TEXT NOT NULL,
    "state" TEXT,
    "planName" TEXT,
    "participants" INTEGER,
    "planYear" INTEGER,

    CONSTRAINT "EmployerEin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployerEin_nameNorm_idx" ON "EmployerEin"("nameNorm");

-- CreateIndex
CREATE INDEX "EmployerEin_state_idx" ON "EmployerEin"("state");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerEin_ein_nameNorm_key" ON "EmployerEin"("ein", "nameNorm");
