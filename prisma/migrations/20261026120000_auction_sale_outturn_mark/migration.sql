-- DropIndex
DROP INDEX "uniq_lots_org_code";

-- AlterTable
ALTER TABLE "auction_procurements" ADD COLUMN     "mark" TEXT,
ADD COLUMN     "outturn_number" TEXT,
ADD COLUMN     "sale_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "uniq_auction_procurements_org_sale_lot" ON "auction_procurements"("organization_id", "sale_number", "auction_lot_number");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_lots_org_code_direct" ON "lots"("organization_id", "lot_code") WHERE (source = 'direct');

