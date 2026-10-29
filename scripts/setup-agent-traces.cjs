const fs = require('node:fs')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')

/** Only add missing columns; never rebuild a table or overwrite an existing event payload. */
async function setupTraceSchema(prisma, provider) {
    if (!['sqlite', 'postgres'].includes(provider)) throw new Error('Expected sqlite or postgres')
    const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', provider, 'agent-traces.sql'), 'utf8')
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement)
    const additions = {
        AgentTrace: { lastSequence: 'INTEGER NOT NULL DEFAULT 0' },
        AgentTraceEvent: { source: "TEXT NOT NULL DEFAULT 'server'", outcome: "TEXT NOT NULL DEFAULT 'unknown'", errorCategory: 'TEXT', errorCode: 'TEXT' },
    }
    for (const [table, columns] of Object.entries(additions)) {
        const existing = provider === 'sqlite' ? await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`)
            : await prisma.$queryRawUnsafe('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', table)
        const names = new Set(existing.map(column => column.name ?? column.column_name))
        for (const [column, definition] of Object.entries(columns)) if (!names.has(column)) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
        }
    }
    await prisma.$executeRawUnsafe('UPDATE "AgentTrace" SET "lastSequence" = COALESCE((SELECT MAX("sequence") FROM "AgentTraceEvent" WHERE "traceId" = "AgentTrace"."id"), 0) WHERE "lastSequence" < COALESCE((SELECT MAX("sequence") FROM "AgentTraceEvent" WHERE "traceId" = "AgentTrace"."id"), 0)')
}

module.exports = { setupTraceSchema }
if (require.main === module) {
    const prisma = new PrismaClient()
    setupTraceSchema(prisma, process.argv[2]).then(() => console.log('Agent trace schema is ready'))
        .catch(error => { console.error('Agent trace setup failed:', error.code ?? error.name); process.exitCode = 1 })
        .finally(() => prisma.$disconnect())
}
