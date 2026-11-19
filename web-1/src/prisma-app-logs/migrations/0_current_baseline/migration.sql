-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "AppLogRecord" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_log_chain_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "user_metadata" TEXT NOT NULL,
    "client_url" TEXT NOT NULL,
    "application" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "AppLogRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppLogRecord_environment_id_idx" ON "AppLogRecord"("environment", "id" DESC);

-- CreateIndex
CREATE INDEX "AppLogRecord_type_created_at_idx" ON "AppLogRecord"("type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "AppLogRecord_user_id_created_at_idx" ON "AppLogRecord"("user_id", "created_at" DESC);

-- CreateIndex
-- Parytet z AiCrawlerEvent (web-1/src/prisma/schema.prisma): agregaty po created_at.
-- admin-health groupBy (application=backend AND created_at>=cutoff) korzysta z
-- composite (application, created_at DESC); retention deleteMany po golym created_at
-- korzysta z bare index. IF NOT EXISTS: entrypoint tez odpala te dwa (baseline ==
-- schema.prisma, brak `migrate deploy` dla app-logs -> podwojna sciezka apply).
CREATE INDEX IF NOT EXISTS "AppLogRecord_application_created_at_idx" ON "AppLogRecord"("application", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AppLogRecord_created_at_idx" ON "AppLogRecord"("created_at");
