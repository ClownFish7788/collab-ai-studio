const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-traces-'))
const filename = path.join(directory, 'test.db')
process.env.DATABASE_URL = `file:${filename.replaceAll('\\', '/')}`
const prisma = require('../src/lib/prisma.ts').default
const { startAgentTrace, consumeAdminLoginAttempt } = require('../src/lib/agentTrace.ts')
const db = new DatabaseSync(filename)
db.exec(fs.readFileSync(path.join(__dirname, '../prisma/sqlite/agent-traces.sql'), 'utf8'))
db.close()
after(async () => { await prisma.$disconnect(); fs.rmSync(directory, { recursive: true, force: true }) })

test('events persist before completion, in order, including failed tool results and redaction', async () => {
    const trace = await startAgentTrace({ id: 'run-1', kind: 'board', userId: 'user-1', roomId: 'room-1',
        model: 'fixture', prompt: '画圆', input: { images: ['data:image/png;base64,QUJD'] } })
    await trace.record('tool_call', { id: 'c1', arguments: '{"color":"blue"}' })
    const running = await prisma.agentTrace.findUnique({ where: { id: 'run-1' }, include: { events: true } })
    assert.equal(running.status, 'running')
    assert.equal(running.events.length, 1)
    await trace.record('tool_result', { ok: false, error: '执行失败', apiKey: 'secret' }, 12)
    await trace.end('failed', undefined, '执行失败')
    const saved = await prisma.agentTrace.findUnique({ where: { id: 'run-1' }, include: { events: { orderBy: { sequence: 'asc' } } } })
    assert.equal(saved.status, 'failed')
    assert.equal(saved.error, '执行失败')
    assert.equal(saved.events[1].sequence > saved.events[0].sequence, true)
    assert.equal(saved.events[1].durationMs, 12)
    assert.doesNotMatch(JSON.stringify(saved), /QUJD|secret/)
})

test('shared DB password budget cannot be bypassed with concurrent attempts and resets next window', async () => {
    const results = await Promise.all(Array.from({ length: 21 }, () => consumeAdminLoginAttempt(1_800_000)))
    assert.equal(results.filter(Boolean).length, 20)
    assert.equal(await consumeAdminLoginAttempt(2_400_000), true)
})

test('failed trace creation does not fail AI or overwrite an existing run', async () => {
    const trace = await startAgentTrace({ id: 'run-1', kind: 'chat', model: 'fixture', prompt: 'duplicate', input: {} })
    await assert.doesNotReject(() => trace.record('model_request', {}))
    await assert.doesNotReject(() => trace.end('completed', 'ok'))
    assert.equal((await prisma.agentTrace.findUnique({ where: { id: 'run-1' } })).status, 'failed')
})
