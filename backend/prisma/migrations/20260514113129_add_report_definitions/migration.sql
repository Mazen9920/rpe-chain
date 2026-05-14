-- CreateTable
CREATE TABLE "ReportDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "reportKey" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'PDF',
    "recipients" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportDefinition_ownerId_isShared_idx" ON "ReportDefinition"("ownerId", "isShared");

-- CreateIndex
CREATE INDEX "ReportDefinition_reportKey_idx" ON "ReportDefinition"("reportKey");

-- CreateIndex
CREATE INDEX "ReportSchedule_isActive_nextRunAt_idx" ON "ReportSchedule"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_definitionId_idx" ON "ReportSchedule"("definitionId");

-- AddForeignKey
ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
