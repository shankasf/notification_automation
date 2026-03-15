-- CreateEnum
CREATE TYPE "RequisitionCategory" AS ENUM ('ENGINEERING_CONTRACTORS', 'CONTENT_TRUST_SAFETY', 'DATA_OPERATIONS', 'MARKETING_CREATIVE', 'CORPORATE_SERVICES');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('OPEN', 'SOURCING', 'INTERVIEWING', 'OFFER', 'ONBOARDING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGE', 'RATE_CHANGE', 'HEADCOUNT_CHANGE', 'BUDGET_CHANGE', 'BULK_IMPORT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CHANGE_SUMMARY', 'ANOMALY_ALERT', 'BUDGET_WARNING', 'MILESTONE');

-- CreateTable
CREATE TABLE "SourcingManager" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "category" "RequisitionCategory" NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcingManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requisition" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "category" "RequisitionCategory" NOT NULL,
    "headcountNeeded" INTEGER NOT NULL,
    "headcountFilled" INTEGER NOT NULL DEFAULT 0,
    "vendor" TEXT NOT NULL,
    "billRateHourly" DOUBLE PRECISION NOT NULL,
    "location" TEXT NOT NULL,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "budgetAllocated" DOUBLE PRECISION NOT NULL,
    "budgetSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequisitionChange" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "changeType" "ChangeType" NOT NULL,
    "fieldChanged" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedBy" TEXT NOT NULL DEFAULT 'system',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequisitionChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketRate" (
    "id" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "category" "RequisitionCategory" NOT NULL,
    "location" TEXT NOT NULL,
    "minRate" DOUBLE PRECISION NOT NULL,
    "maxRate" DOUBLE PRECISION NOT NULL,
    "medianRate" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rolesScraped" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "managerId" TEXT,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourcingManager_email_key" ON "SourcingManager"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Requisition_requisitionId_key" ON "Requisition"("requisitionId");

-- AddForeignKey
ALTER TABLE "RequisitionChange" ADD CONSTRAINT "RequisitionChange_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "SourcingManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "SourcingManager"("id") ON DELETE CASCADE ON UPDATE CASCADE;
