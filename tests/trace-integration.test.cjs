const { test, after, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-integration-'))
process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`
process.env.API_KEY = 'transport-secret'
process.env.BASE_MODEL = 'fixture'
process.env.BASE_URL = 'https://fixture.invalid'
const db = new DatabaseSync(path.join(directory, 'test.db'))
db.exec(fs.readFileSync(path.join(__dirname, '../prisma/sqlite/agent-traces.sql'), 'utf8'))
db.close()
const prisma = require('../src/lib/prisma.ts').default
after(async () => { mock.restoreAll(); await prisma.$disconnect(); fs.rmSync(directory, { recursive: true, force: true }) })
// Only external authentication and model transport are faked; loop validation and trace storage remain real.
const authModule = require('next-auth')
let authenticated = true
require.cache[require.resolve('next-auth')].exports = { ...authModule, __esModule: true,
    getServerSession: async () => authenticated ? { user: { id: 'fixture-user' } } : null,
}
const { POST } = require('../src/app/api/chat/route.ts')
const { startAgentTrace } = require('../src/lib/agentTrace.ts')
const { observeModelFetch } = require('../src/lib/modelTrace.ts')
const { beginCreateRun, runCreateLoop, submitCreateResult } = require('../src/lib/boardCreateRun.ts')
const { requestBoardCreateModel } = require('../src/lib/boardCreateModel.ts')
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const modelResponse = message => Response.json({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content: null, ...message } }] })

test('ordinary chat records the actual context and final reply without changing SSE or exposing credentials', async () => {
    const raw = 'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"你好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    const transport = mock.method(globalThis, 'fetch', async () => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }))
    const response = await POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: '问好' }] }) }))
    assert.equal(await response.text(), raw)
    transport.mock.restore()
    const saved = await prisma.agentTrace.findFirst({ where: { kind: 'chat' }, include: { events: true } })
    assert.ok(saved, 'accepted chat must create a persistent trace')
    assert.equal(saved.userId, 'fixture-user')
    assert.equal(saved.status, 'completed')
    assert.equal(saved.reply, '你好')
    const request = JSON.parse(saved.events.find(e => e.type === 'model_request').data).request
    assert.equal(request.messages[0].content, '问好')
    assert.equal(request.enable_thinking, false)
    assert.doesNotMatch(JSON.stringify(saved), /transport-secret/)
})

test('board snapshot, ask_user answer, parameter repair and draft mutation form one trace', async () => {
    const run = beginCreateRun('fixture-owner', 'room-1', new AbortController().signal)
    const trace = await startAgentTrace({ id: run.id, kind: 'board', userId: run.ownerId, roomId: run.roomId, model: 'fixture', prompt: '画一个圆', input: {} })
    const shape = { geo: 'ellipse', x: 0, y: 0, w: 100, h: 100, color: 'blue' }
    const calls = [call('read', 'get_board_snapshot', { range: 'viewport' }), call('ask', 'ask_user', { question: '什么颜色？' }),
        call('bad', 'create_shapes', { shapes: [{ ...shape, w: -1 }] }), call('create', 'create_shapes', { shapes: [shape] })]
    let requestIndex = 0
    const fetcher = observeModelFetch(trace.record, async () => requestIndex < calls.length
        ? modelResponse({ tool_calls: [calls[requestIndex++]] }) : modelResponse({ content: '已生成蓝色圆形草稿' }))
    let final
    await runCreateLoop(run, { roomId: run.roomId, prompt: '画一个圆' },
        (messages, tools) => requestBoardCreateModel(messages, { apiKey: 'transport-secret', model: 'fixture', baseUrl: 'https://fixture.invalid' }, run.signal, tools, fetcher),
        event => {
            if (event.type === 'completed') final = event.text
            if (event.type !== 'tool') return
            const output = event.call.function.name === 'get_board_snapshot'
                ? { ok: true, state: 'draft', range: 'viewport', truncated: false, snapshot: { reference: { id: null, x: 0, y: 0 }, shapes: [] } }
                : event.call.function.name === 'ask_user' ? { ok: true, answer: '蓝色' }
                    : { ok: true, state: 'draft', shapes: [{ ...shape, id: 'shape:created', type: 'geo' }] }
            submitCreateResult(run.id, run.ownerId, event.call.id, output)
        }, async () => {}, 100, trace.record)
    await trace.end('completed', final)
    const saved = await prisma.agentTrace.findUnique({ where: { id: run.id }, include: { events: { orderBy: { sequence: 'asc' } } } })
    assert.equal(saved.events.filter(e => e.type === 'tool_call').length, 3)
    assert.equal(saved.events.filter(e => e.type === 'tool_result').length, 3)
    assert.equal(saved.events.filter(e => e.type === 'tool_validation_error').length, 1)
    assert.equal(JSON.parse(saved.events.find(e => e.type === 'tool_validation_error').data).willRetry, true)
    assert.match(saved.events.find(e => e.type === 'tool_result' && e.data.includes('蓝色')).data, /蓝色/)
    assert.equal(saved.reply, '已生成蓝色圆形草稿')
})

test('failed tool results are retained before the board loop throws', async () => {
    const run = beginCreateRun('failed-owner', 'room-1', new AbortController().signal)
    const events = []
    const requestCall = call('read-fail', 'get_board_snapshot', { range: 'viewport' })
    await assert.rejects(() => runCreateLoop(run, { roomId: 'room-1', prompt: '查看画布' }, async () => ({ kind: 'tool', call: requestCall }),
        event => { if (event.type === 'tool') submitCreateResult(run.id, run.ownerId, event.call.id, { ok: false, error: { code: 'EXECUTION_FAILED', message: '读取失败' } }) },
        async () => {}, 100, async (...e) => events.push(e)), /读取失败/)
    assert.equal(events.find(e => e[0] === 'tool_result')[1].output.ok, false)
})

test('chat network failures return the existing error response and finish their trace', async () => {
    const transport = mock.method(globalThis, 'fetch', async () => { throw Error('fixture network failure') })
    const response = await POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'network-error' }] }) }))
    transport.mock.restore()
    assert.equal(response.status, 502)
    const saved = await prisma.agentTrace.findFirst({ where: { prompt: 'network-error' }, include: { events: true } })
    assert.equal(saved.status, 'failed')
    assert.ok(saved.events.some(e => e.errorCategory === 'network'))
})

test('cancelling a chat stream persists partial output and cancellation', async () => {
    const raw = 'data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n'
    const transport = mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(raw))
    } }), { headers: { 'content-type': 'text/event-stream' } }))
    const response = await POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'cancel-stream' }] }) }))
    const reader = response.body.getReader()
    await reader.read()
    await reader.cancel()
    transport.mock.restore()
    const saved = await prisma.agentTrace.findFirst({ where: { prompt: 'cancel-stream' }, include: { events: true } })
    assert.equal(saved.status, 'cancelled')
    assert.equal(saved.reply, 'partial')
    assert.ok(saved.events.some(e => e.outcome === 'cancelled' && e.errorCategory === 'cancelled'))
})

test('rejected chat requests are captured before a model run exists, with stable error categories', async () => {
    const invalid = await POST(new Request('http://localhost/api/chat', { method: 'POST', body: '{' }))
    assert.equal(invalid.status, 400)
    assert.ok(invalid.headers.get('x-agent-trace-id'))
    const rejected = await prisma.agentTrace.findUnique({ where: { id: invalid.headers.get('x-agent-trace-id') }, include: { events: true } })
    assert.equal(rejected.status, 'failed')
    assert.ok(rejected.events.some(e => e.errorCategory === 'validation'))
    const saved = process.env.API_KEY
    delete process.env.API_KEY
    const missing = await POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'configuration-error' }] }) }))
    process.env.API_KEY = saved
    assert.equal(missing.status, 500)
    const config = await prisma.agentTrace.findUnique({ where: { id: missing.headers.get('x-agent-trace-id') }, include: { events: true } })
    assert.ok(config.events.some(e => e.errorCategory === 'configuration'))
    authenticated = false
    const denied = await POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'auth-error' }] }) }))
    authenticated = true
    assert.equal(denied.status, 401)
    const auth = await prisma.agentTrace.findUnique({ where: { id: denied.headers.get('x-agent-trace-id') }, include: { events: true } })
    assert.ok(auth.events.some(e => e.errorCategory === 'authentication'))
})
