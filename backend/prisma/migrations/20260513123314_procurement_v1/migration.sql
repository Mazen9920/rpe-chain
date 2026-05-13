-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "fxRateAtReceipt" DECIMAL(14,6),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "reverseReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" TEXT;

-- AlterTable
ALTER TABLE "GoodsReceiptLine" ADD COLUMN     "qaActionedAt" TIMESTAMP(3),
ADD COLUMN     "qaActionedById" TEXT,
ADD COLUMN     "qaNotes" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "requestedById" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "defaultReceivingBinId" TEXT,
ADD COLUMN     "lotPrefix" TEXT;

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_warehouseId_receivedAt_idx" ON "GoodsReceipt"("warehouseId", "receivedAt");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_receiptId_idx" ON "GoodsReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_poLineId_idx" ON "GoodsReceiptLine"("poLineId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_expectedDate_idx" ON "PurchaseOrder"("status", "expectedDate");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_status_idx" ON "PurchaseOrderLine"("purchaseOrderId", "status");

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_defaultReceivingBinId_fkey" FOREIGN KEY ("defaultReceivingBinId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_qaActionedById_fkey" FOREIGN KEY ("qaActionedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
