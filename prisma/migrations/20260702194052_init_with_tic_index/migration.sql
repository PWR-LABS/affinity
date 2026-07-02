-- CreateEnum
CREATE TYPE "CoverageKind" AS ENUM ('PROVIDER', 'DRUG');

-- CreateEnum
CREATE TYPE "CoverageSource" AS ENUM ('MARKETPLACE_API', 'ISSUER_MRF', 'ISSUER_TIC_MRF', 'CROWD', 'SECRET_SHOPPER');

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "zip" TEXT NOT NULL,
    "countyFips" TEXT,
    "state" TEXT,
    "householdIncomeUsd" INTEGER,
    "householdSize" INTEGER,
    "memberAges" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRef" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "npi" TEXT NOT NULL,
    "name" TEXT,
    "specialty" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationRef" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "rxcui" TEXT,
    "name" TEXT NOT NULL,
    "dosage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "issuerName" TEXT NOT NULL,
    "marketingName" TEXT NOT NULL,
    "metalLevel" TEXT NOT NULL,
    "planType" TEXT,
    "ratingAreaId" TEXT,
    "premiumUsdMonthly" INTEGER,
    "deductibleUsd" INTEGER,
    "oopMaxUsd" INTEGER,
    "primaryCareCopayUsd" INTEGER,
    "coinsuranceRate" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageClaim" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "CoverageKind" NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "subjectLabel" TEXT,
    "inNetwork" BOOLEAN,
    "onFormulary" BOOLEAN,
    "formularyTier" TEXT,
    "source" "CoverageSource" NOT NULL,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "sourceLastUpdated" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL,
    "agreesWith" "CoverageSource"[],
    "conflictsWith" "CoverageSource"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicFile" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "reportingEntity" TEXT NOT NULL,
    "sourceLastUpdated" TIMESTAMP(3),
    "schemaMode" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicMembership" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "npi" TEXT NOT NULL,
    "tinType" TEXT NOT NULL,
    "tinValue" TEXT NOT NULL,

    CONSTRAINT "TicMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicPlanLink" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "planIdType" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planMarketType" TEXT,

    CONSTRAINT "TicPlanLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderRef_profileId_idx" ON "ProviderRef"("profileId");

-- CreateIndex
CREATE INDEX "ProviderRef_npi_idx" ON "ProviderRef"("npi");

-- CreateIndex
CREATE INDEX "MedicationRef_profileId_idx" ON "MedicationRef"("profileId");

-- CreateIndex
CREATE INDEX "MedicationRef_rxcui_idx" ON "MedicationRef"("rxcui");

-- CreateIndex
CREATE INDEX "Plan_ratingAreaId_year_idx" ON "Plan"("ratingAreaId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_externalId_year_key" ON "Plan"("externalId", "year");

-- CreateIndex
CREATE INDEX "CoverageClaim_planId_kind_subjectKey_idx" ON "CoverageClaim"("planId", "kind", "subjectKey");

-- CreateIndex
CREATE UNIQUE INDEX "TicFile_url_key" ON "TicFile"("url");

-- CreateIndex
CREATE INDEX "TicFile_reportingEntity_idx" ON "TicFile"("reportingEntity");

-- CreateIndex
CREATE INDEX "TicMembership_npi_idx" ON "TicMembership"("npi");

-- CreateIndex
CREATE UNIQUE INDEX "TicMembership_fileId_npi_tinValue_key" ON "TicMembership"("fileId", "npi", "tinValue");

-- CreateIndex
CREATE INDEX "TicPlanLink_planIdType_planId_idx" ON "TicPlanLink"("planIdType", "planId");

-- CreateIndex
CREATE INDEX "TicPlanLink_fileId_idx" ON "TicPlanLink"("fileId");

-- AddForeignKey
ALTER TABLE "ProviderRef" ADD CONSTRAINT "ProviderRef_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationRef" ADD CONSTRAINT "MedicationRef_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageClaim" ADD CONSTRAINT "CoverageClaim_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicMembership" ADD CONSTRAINT "TicMembership_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "TicFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicPlanLink" ADD CONSTRAINT "TicPlanLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "TicFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
