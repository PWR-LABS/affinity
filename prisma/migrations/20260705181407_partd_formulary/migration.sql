-- AlterEnum
ALTER TYPE "CoverageSource" ADD VALUE 'CMS_PARTD';

-- CreateTable
CREATE TABLE "PartDPlan" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "contractYear" INTEGER NOT NULL,
    "planName" TEXT NOT NULL,
    "formularyId" TEXT NOT NULL,
    "state" TEXT,

    CONSTRAINT "PartDPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartDFormularyDrug" (
    "id" TEXT NOT NULL,
    "formularyId" TEXT NOT NULL,
    "contractYear" INTEGER NOT NULL,
    "rxcui" TEXT NOT NULL,
    "tier" INTEGER,
    "priorAuthorization" BOOLEAN,
    "stepTherapy" BOOLEAN,
    "quantityLimit" BOOLEAN,
    "quantityLimitAmount" DOUBLE PRECISION,
    "quantityLimitDays" INTEGER,

    CONSTRAINT "PartDFormularyDrug_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartDPlan_formularyId_idx" ON "PartDPlan"("formularyId");

-- CreateIndex
CREATE INDEX "PartDPlan_state_idx" ON "PartDPlan"("state");

-- CreateIndex
CREATE UNIQUE INDEX "PartDPlan_contractId_planId_segmentId_contractYear_key" ON "PartDPlan"("contractId", "planId", "segmentId", "contractYear");

-- CreateIndex
CREATE INDEX "PartDFormularyDrug_rxcui_idx" ON "PartDFormularyDrug"("rxcui");

-- CreateIndex
CREATE UNIQUE INDEX "PartDFormularyDrug_formularyId_contractYear_rxcui_key" ON "PartDFormularyDrug"("formularyId", "contractYear", "rxcui");
