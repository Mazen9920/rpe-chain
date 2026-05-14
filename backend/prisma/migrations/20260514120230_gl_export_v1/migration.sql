-- CreateEnum
CREATE TYPE "GlAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateTable
CREATE TABLE "GlAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GlAccountType" NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlAccountMapping" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "debitAccountId" TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlAccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlJournal" (
    "id" TEXT NOT NULL,
    "journalNumber" TEXT NOT NULL,
    "sourceLedger" TEXT NOT NULL,
    "sourceEntryId" TEXT NOT NULL,
    "sourceEntryType" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "exportedAt" TIMESTAMP(3),
    "exportProvider" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlJournalLine" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "GlJournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlIntegrationCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "realmId" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "meta" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlIntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlAccount_code_key" ON "GlAccount"("code");

-- CreateIndex
CREATE INDEX "GlAccount_type_isActive_idx" ON "GlAccount"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "GlAccountMapping_eventType_key" ON "GlAccountMapping"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "GlJournal_journalNumber_key" ON "GlJournal"("journalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GlJournal_sourceEntryId_key" ON "GlJournal"("sourceEntryId");

-- CreateIndex
CREATE INDEX "GlJournal_postedAt_idx" ON "GlJournal"("postedAt");

-- CreateIndex
CREATE INDEX "GlJournal_sourceLedger_sourceEntryType_idx" ON "GlJournal"("sourceLedger", "sourceEntryType");

-- CreateIndex
CREATE INDEX "GlJournalLine_journalId_idx" ON "GlJournalLine"("journalId");

-- CreateIndex
CREATE INDEX "GlJournalLine_accountId_idx" ON "GlJournalLine"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "GlIntegrationCredential_provider_key" ON "GlIntegrationCredential"("provider");

-- AddForeignKey
ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "GlAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlAccountMapping" ADD CONSTRAINT "GlAccountMapping_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlAccountMapping" ADD CONSTRAINT "GlAccountMapping_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlJournalLine" ADD CONSTRAINT "GlJournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "GlJournal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlJournalLine" ADD CONSTRAINT "GlJournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
