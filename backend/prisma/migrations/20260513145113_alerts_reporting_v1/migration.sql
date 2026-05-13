/*
  Warnings:

  - Added the required column `updatedAt` to the `Alert` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "audienceRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "sourceEventId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "params" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertRule_type_key" ON "AlertRule"("type");

-- CreateIndex
CREATE INDEX "Alert_status_type_idx" ON "Alert"("status", "type");

-- CreateIndex
CREATE INDEX "Alert_type_entityType_entityId_idx" ON "Alert"("type", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "Forecast_productId_periodStart_idx" ON "Forecast"("productId", "periodStart");
