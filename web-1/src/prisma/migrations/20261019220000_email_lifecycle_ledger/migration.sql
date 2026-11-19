-- CreateTable
CREATE TABLE "FreeEmailEnrollment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "finishedAt" TIMESTAMP(3),
    "finishReason" TEXT,

    CONSTRAINT "FreeEmailEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLifecycleCampaign" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'OFF',
    "startedAt" TIMESTAMP(3),
    "initializedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLifecycleCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLifecycleMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "occurrence" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "sweepId" TEXT,
    "opportunityId" TEXT,
    "nonTransactional" BOOLEAN NOT NULL DEFAULT true,
    "recipientAddressHash" TEXT,
    "locale" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "ctaIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "deliveryStatus" TEXT,
    "deliveryAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "EmailLifecycleMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDeliveryEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "replayToken" TEXT,
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDeliverySuppression" (
    "addressHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDeliverySuppression_pkey" PRIMARY KEY ("addressHash")
);

-- CreateTable
CREATE TABLE "EmailLifecycleEntry" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ctaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLifecycleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLifecycleOperationalEvent" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "kind" TEXT NOT NULL,
    "state" TEXT,
    "reason" TEXT,
    "dimensions" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedAt" TIMESTAMP(3),

    CONSTRAINT "EmailLifecycleOperationalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLifecycleAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLifecycleAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FreeEmailEnrollment_accountId_key" ON "FreeEmailEnrollment"("accountId");

-- CreateIndex
CREATE INDEX "FreeEmailEnrollment_status_startedAt_idx" ON "FreeEmailEnrollment"("status", "startedAt");

-- CreateIndex
CREATE INDEX "EmailLifecycleMessage_userId_createdAt_idx" ON "EmailLifecycleMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLifecycleMessage_status_createdAt_idx" ON "EmailLifecycleMessage"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLifecycleMessage_accountId_occurrence_ruleId_key" ON "EmailLifecycleMessage"("accountId", "occurrence", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLifecycleMessage_accountId_occurrence_opportunityId_key" ON "EmailLifecycleMessage"("accountId", "occurrence", "opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLifecycleMessage_provider_providerMessageId_key" ON "EmailLifecycleMessage"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "EmailDeliveryEvent_createdAt_idx" ON "EmailDeliveryEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDeliveryEvent_provider_providerEventId_key" ON "EmailDeliveryEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDeliveryEvent_provider_replayToken_key" ON "EmailDeliveryEvent"("provider", "replayToken");

-- CreateIndex
CREATE INDEX "EmailLifecycleEntry_userId_createdAt_idx" ON "EmailLifecycleEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLifecycleOperationalEvent_exportedAt_occurredAt_idx" ON "EmailLifecycleOperationalEvent"("exportedAt", "occurredAt");

-- CreateIndex
CREATE INDEX "EmailLifecycleAction_userId_occurredAt_idx" ON "EmailLifecycleAction"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "FreeEmailEnrollment" ADD CONSTRAINT "FreeEmailEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLifecycleMessage" ADD CONSTRAINT "EmailLifecycleMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDeliveryEvent" ADD CONSTRAINT "EmailDeliveryEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailLifecycleMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLifecycleEntry" ADD CONSTRAINT "EmailLifecycleEntry_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailLifecycleMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLifecycleEntry" ADD CONSTRAINT "EmailLifecycleEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLifecycleOperationalEvent" ADD CONSTRAINT "EmailLifecycleOperationalEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailLifecycleMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLifecycleAction" ADD CONSTRAINT "EmailLifecycleAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

