-- Temporary execution channel; independent of best-effort trace storage.
CREATE TABLE IF NOT EXISTS "BoardAgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "BoardAgentRun_ownerId_key" ON "BoardAgentRun"("ownerId");
CREATE INDEX IF NOT EXISTS "BoardAgentRun_expiresAt_idx" ON "BoardAgentRun"("expiresAt");
CREATE TABLE IF NOT EXISTS "BoardAgentToolCall" (
    "runId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "callJson" TEXT NOT NULL,
    "deadlineAt" DATETIME NOT NULL,
    "outputJson" TEXT,
    "receivedAt" DATETIME,
    PRIMARY KEY ("runId", "callId"),
    FOREIGN KEY ("runId") REFERENCES "BoardAgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
