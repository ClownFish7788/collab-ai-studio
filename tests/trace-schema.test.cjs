const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { PrismaClient } = require('@prisma/client')
const { setupTraceSchema } = require('../scripts/setup-agent-traces.cjs')

test('schema setup upgrades existing records without data loss and is safe to repeat', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-upgrade-'))
    const filename = path.join(directory, 'test.db')
    const db = new DatabaseSync(filename)
    db.exec(`CREATE TABLE AgentTrace (id TEXT PRIMARY KEY, kind TEXT NOT NULL, userId TEXT, roomId TEXT, model TEXT NOT NULL, prompt TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', reply TEXT, error TEXT, durationMs INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE AgentTraceEvent (id TEXT PRIMARY KEY, traceId TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, durationMs INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO AgentTrace (id,kind,model,prompt,input) VALUES ('old','chat','fixture','preserved','{}');
        INSERT INTO AgentTraceEvent (id,traceId,sequence,type,data) VALUES ('e1','old',9,'tool_result','{"output":{"ok":false}}');`)
    db.close()
    const prisma = new PrismaClient({ datasources: { db: { url: `file:${filename.replaceAll('\\', '/')}` } } })
    try {
        await setupTraceSchema(prisma, 'sqlite')
        await setupTraceSchema(prisma, 'sqlite')
        const row = await prisma.agentTrace.findUnique({ where: { id: 'old' }, include: { events: true } })
        assert.equal(row.prompt, 'preserved')
        assert.equal(row.events[0].data, '{"output":{"ok":false}}')
        assert.equal(row.events[0].outcome, 'unknown')
        assert.equal(row.lastSequence, 9)
    } finally { await prisma.$disconnect(); fs.rmSync(directory, { recursive: true, force: true }) }
})
