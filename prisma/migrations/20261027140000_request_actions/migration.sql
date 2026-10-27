ALTER TABLE "Request"
  ADD COLUMN "dismissedAt" TIMESTAMP(3),
  ADD COLUMN "settings" JSONB,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "activeActionId" TEXT;
ALTER TABLE "SceneIndex"
  ADD COLUMN "requestDismissedAt" TIMESTAMP(3),
  ADD COLUMN "requestRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "RequestAction" (
  "id" TEXT PRIMARY KEY,
  "stashId" TEXT NOT NULL REFERENCES "Request"("stashId") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'RUNNING',
  "details" JSONB,
  "result" JSONB,
  "dispatchedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "RequestAction_stashId_createdAt_idx" ON "RequestAction"("stashId", "createdAt");
