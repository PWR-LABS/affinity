-- AlterTable
ALTER TABLE "PartDPlan" ADD COLUMN "pdpRegionCode" TEXT;

-- CreateIndex
CREATE INDEX "PartDPlan_pdpRegionCode_idx" ON "PartDPlan"("pdpRegionCode");
