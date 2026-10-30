-- Additive setup for existing databases; safe to run more than once.
CREATE TABLE IF NOT EXISTS "AgentTrace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "userId" TEXT,
  "roomId" TEXT,
  "model" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "input" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "reply" TEXT,
  "error" TEXT,
  "durationMs" INTEGER,
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AgentTrace_createdAt_id_idx" ON "AgentTrace"("createdAt", "id");
CREATE TABLE IF NOT EXISTS "AgentTraceEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "traceId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'server',
  "outcome" TEXT NOT NULL DEFAULT 'unknown',
  "errorCategory" TEXT,
  "errorCode" TEXT,
  "data" TEXT NOT NULL,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentTraceEvent_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "AgentTrace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentTraceEvent_traceId_sequence_key" ON "AgentTraceEvent"("traceId", "sequence");
CREATE TABLE IF NOT EXISTS "TraceAdminLogin" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "TraceAdminLogin_expiresAt_idx" ON "TraceAdminLogin"("expiresAt");
