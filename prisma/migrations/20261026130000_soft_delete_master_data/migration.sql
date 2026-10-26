-- Soft delete for master data: rows are flagged instead of removed, so lots,
-- contracts and agreements that reference them keep their history.

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "buyers" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "grades" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "bag_types" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- DropForeignKey
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_grade_id_fkey";

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
