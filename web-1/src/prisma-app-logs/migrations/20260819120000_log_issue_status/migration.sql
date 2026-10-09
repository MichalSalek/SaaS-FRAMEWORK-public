-- CreateTable
CREATE TABLE "LogIssueStatus" (
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "application" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "LogIssueStatus_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateIndex
CREATE INDEX "LogIssueStatus_status_idx" ON "LogIssueStatus"("status");
