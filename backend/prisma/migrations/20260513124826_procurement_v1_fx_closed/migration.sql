-- AlterEnum
ALTER TYPE "POStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "fxRate" DECIMAL(14,6);
