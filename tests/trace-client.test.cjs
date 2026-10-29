const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-client-'))
process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`
const db = new DatabaseSync(path.join(directory, 'test.db'))
db.exec(fs.readFileSync(path.join(__dirname, '../prisma/sqlite/agent-traces.sql'), 'utf8')); db.close()
const prisma = require('../src/lib/prisma.ts').default
const auth = require('next-auth')
require.cache[require.resolve('next-auth')].exports = { ...auth, __esModule: true, getServerSession: async () => ({ user: { id: 'owner' } }) }
const { startAgentTrace } = require('../src/lib/agentTrace.ts')
const { POST } = require('../src/app/api/agent-traces/[id]/events/route.ts')
const { POST: submitResult } = require('../src/app/api/board-create/[runId]/result/route.ts')
const { parseClientTraceEvent, reportAgentOperation } = require('../src/utils/agent-traces/client.ts')
after(async () => { await prisma.$disconnect(); fs.rmSync(directory, { recursive: true, force: true }) })
const call = (id, body, origin = 'http://localhost') => POST(new Request(`http://localhost/api/agent-traces/${id}/events`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
}), { params: Promise.resolve({ id }) })

test('client event contract rejects fabricated authority, unknown operations and oversized diagnostics', () => {
    assert.throws(() => parseClientTraceEvent({ operation: 'delete_database', outcome: 'success' }))
    assert.throws(() => parseClientTraceEvent({ operation: 'draft_apply', outcome: 'success', status: 'completed' }))
    assert.throws(() => parseClientTraceEvent({ operation: 'draft_apply', outcome: 'error', error: { message: 'x'.repeat(1100) } }))
    assert.throws(() => parseClientTraceEvent({ operation: 'draft_apply', outcome: 'error', error: { category: 'permission' } }))
    assert.equal(parseClientTraceEvent({ operation: 'draft_apply', outcome: 'success' }).operation, 'draft_apply')
})

test('client reporter sends bounded diagnostics, and reporting failure never fails the user operation', async () => {
    let body
    await reportAgentOperation('own', 'draft_apply', 'error', Error('conflict'), 12, async (url, init) => { body = JSON.parse(init.body); return Response.json({ accepted: true }) })
    assert.equal(body.operation, 'draft_apply')
    assert.equal(body.outcome, 'error')
    assert.equal(body.error.message, 'conflict')
    await assert.doesNotReject(() => reportAgentOperation('own', 'stream_receive', 'error', Error('network'), 12, async () => { throw Error('offline') }))
})

test('browser events are owner-only, bounded and cannot change the server result', async () => {
    const trace = await startAgentTrace({ id: 'own', kind: 'board', userId: 'owner', model: 'fixture', prompt: 'draft', input: {} })
    await trace.end('completed', 'draft generated')
    await startAgentTrace({ id: 'other', kind: 'board', userId: 'another-user', model: 'fixture', prompt: 'private', input: {} })
    assert.equal((await call('other', { operation: 'draft_apply', outcome: 'success' })).status, 404)
    assert.equal((await call('own', { operation: 'draft_apply', outcome: 'success' }, 'https://attacker.invalid')).status, 403)
    assert.equal((await call('own', { operation: 'draft_apply', outcome: 'error', error: { name: 'Error', message: 'conflict' } })).status, 200)
    const row = await prisma.agentTrace.findUnique({ where: { id: 'own' }, include: { events: true } })
    assert.equal(row.status, 'completed')
    const event = row.events.find(e => e.source === 'client')
    assert.equal(event.outcome, 'error')
    assert.equal(event.errorCategory, 'draft')
    for (let i = 0; i < 31; i++) assert.equal((await call('own', { operation: 'draft_apply', outcome: 'success' })).status, 200)
    assert.equal((await call('own', { operation: 'draft_apply', outcome: 'success' })).status, 429)
})

test('late rejected tool results attach to the owner trace without changing its completed state', async () => {
    const trace = await startAgentTrace({ id: 'late', kind: 'board', userId: 'owner', model: 'fixture', prompt: 'done', input: {} })
    await trace.end('completed', 'done')
    const response = await submitResult(new Request('http://localhost/api/board-create/late/result', { method: 'POST', body: '{}' }), { params: Promise.resolve({ runId: 'late' }) })
    assert.equal(response.status, 409)
    const row = await prisma.agentTrace.findUnique({ where: { id: 'late' }, include: { events: true } })
    assert.equal(row.status, 'completed')
    assert.ok(row.events.some(e => e.errorCategory === 'protocol' && e.data.includes('result_submit')))
})
