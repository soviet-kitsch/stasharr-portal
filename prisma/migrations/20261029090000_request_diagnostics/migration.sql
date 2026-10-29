CREATE TABLE "RequestDiagnosticEvent" (
 "id" TEXT PRIMARY KEY, "stashId" TEXT NOT NULL, "source" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "label" TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL,
 "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RequestDiagnosticEvent_stashId_occurredAt_id_idx" ON "RequestDiagnosticEvent"("stashId", "occurredAt", "id");
CREATE TABLE "RequestSearchAttempt" (
 "id" TEXT PRIMARY KEY, "stashId" TEXT NOT NULL, "source" TEXT NOT NULL,
 "movieId" INTEGER NOT NULL, "commandId" INTEGER, "mode" TEXT NOT NULL,
 "state" TEXT NOT NULL, "outcome" TEXT NOT NULL DEFAULT 'UNKNOWN',
 "candidateCount" INTEGER, "rejectedCount" INTEGER, "candidates" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "RequestSearchAttempt_stashId_createdAt_id_idx" ON "RequestSearchAttempt"("stashId", "createdAt", "id");
CREATE INDEX "RequestSearchAttempt_state_mode_createdAt_idx" ON "RequestSearchAttempt"("state", "mode", "createdAt");
CREATE UNIQUE INDEX "RequestSearchAttempt_one_diagnostic" ON "RequestSearchAttempt" ((1)) WHERE "mode"='DIAGNOSTIC' AND "state" IN ('QUEUED','RUNNING','UNCERTAIN');
CREATE TABLE "RequestDiagnosticObservation" (
 "stashId" TEXT PRIMARY KEY, "source" TEXT NOT NULL, "signature" TEXT NOT NULL,
 "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "activityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "code" TEXT NOT NULL DEFAULT 'UNKNOWN', "label" TEXT NOT NULL DEFAULT 'No search history',
 "detail" TEXT NOT NULL DEFAULT '', "priority" INTEGER NOT NULL DEFAULT 2, "performers" TEXT[] NOT NULL DEFAULT '{}',
 "performerText" TEXT NOT NULL DEFAULT '', "metadataAt" TIMESTAMP(3), "metadataSource" TEXT, "requestedAt" TIMESTAMP(3),
 CONSTRAINT "RequestDiagnosticObservation_stashId_fkey" FOREIGN KEY ("stashId") REFERENCES "SceneIndex"("stashId") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX "RequestDiagnosticObservation_code_idx" ON "RequestDiagnosticObservation"("code");
CREATE TABLE "RequestDiagnosticSync" (
 "source" TEXT PRIMARY KEY, "since" TIMESTAMP(3) NOT NULL,
 "checkedAt" TIMESTAMP(3), "error" TEXT
);
CREATE TABLE "HydraSearchSettings" (
 "id" TEXT PRIMARY KEY DEFAULT 'default', "browserUrl" TEXT NOT NULL DEFAULT '',
 "studio" BOOLEAN NOT NULL DEFAULT true, "performers" BOOLEAN NOT NULL DEFAULT true,
 "title" BOOLEAN NOT NULL DEFAULT false
);
