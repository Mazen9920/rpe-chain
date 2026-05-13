-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "externalIds" JSONB;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "labelKey" TEXT,
ADD COLUMN     "lastTrackingEventId" TEXT;

-- CreateTable
CREATE TABLE "IntegrationOutbox" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertType" TEXT,
    "severity" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOutbox_idempotencyKey_key" ON "IntegrationOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IntegrationOutbox_status_nextAttemptAt_idx" ON "IntegrationOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "IntegrationOutbox_target_status_idx" ON "IntegrationOutbox"("target", "status");

-- CreateIndex
CREATE INDEX "AlertSubscription_userId_isActive_idx" ON "AlertSubscription"("userId", "isActive");

-- CreateIndex
CREATE INDEX "AlertSubscription_alertType_severity_isActive_idx" ON "AlertSubscription"("alertType", "severity", "isActive");

-- AddForeignKey
ALTER TABLE "AlertSubscription" ADD CONSTRAINT "AlertSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
