const assert = require('node:assert/strict')
const { test } = require('node:test')
const Module = require('node:module')
const { submitCreateResult } = require('../src/lib/boardCreateRun.ts')
const { streamBoardCreateRun } = require('../src/utils/board/agent/streamBoardCreateRun.ts')

const userId = 'board-stream-test-user'
const traces = []
// Only replace authentication and trace storage; run the real route, model adapter and tool loop.
const load = Module._load
let POST
try {
    Module._load = function (name, ...args) {
        if (name === '@/lib/boardCreateAccess') return {
            CreateAccessError: class extends Error {},
            requireCreateUser: async () => userId,
            requireCreateAccess: async () => {},
            readCreatePayload: request => request.json(),
        }
        if (name === '@/lib/agentTraceRequest') return {
            traceAgentRequest: async (_request, _kind, handler) => {
                const trace = {
                    id: crypto.randomUUID(), events: [],
                    record: async (type, data) => { trace.events.push({ type, data }) },
                    step: async (_name, work) => work(), context: async () => {}, end: async () => {},
                }
                traces.push(trace)
                const response = await handler(trace)
                response.headers.set('X-Agent-Trace-Id', trace.id)
                return response
            },
        }
        return load.call(this, name, ...args)
    }
    ;({ POST } = require('../src/app/api/board-create/route.ts'))
} finally { Module._load = load }

const jsonReply = content => Response.json({ choices: [{
    message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop',
}] })
function streamedReply(text, call) {
    const frame = { choices: [{ index: 0, delta: {
        role: 'assistant', content: text,
        ...(call ? { tool_calls: [{ index: 0, ...call }] } : {}),
    }, finish_reason: call ? 'tool_calls' : 'stop' }] }
    return new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
    })
}
function configureModel(t, fetcher) {
    for (const key of ['API_KEY', 'BASE_MODEL', 'BASE_URL']) {
        const previous = process.env[key]
        process.env[key] = key === 'BASE_URL' ? 'https://model.test' : 'test'
        t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
    }
    t.mock.method(globalThis, 'fetch', fetcher)
}
async function browserFetch(url, init) {
    if (url === '/api/board-create') return POST(new Request(`https://app.test${url}`, init))
    const result = /^\/api\/board-create\/([^/]+)\/result$/.exec(url)
    if (result) {
        const { callId, output } = JSON.parse(init.body)
        submitCreateResult(result[1], userId, callId, output)
    }
    return Response.json({ accepted: true })
}

test('白板模型的提前完成声明只留在追踪中，页面仍接收真实读取和询问进度', async t => {
    const elements = [{ key: 'box', operation: 'create', type: 'geo', known: {}, missing: [{ field: '颜色', source: 'ask' }] }]
    const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify({ ...args, elements }) } })
    const misleading = '已经创建并应用到正式白板'
    const responses = [
        jsonReply({ kind: 'task', brief: {
            goal: '新增矩形，颜色先询问', tasks: ['读取白板', '询问颜色', '新增矩形'],
            objects: [{ key: 'box', role: '矩形', description: '待新增' }],
            relations: [], constraints: ['颜色先询问'], unresolvedQuestions: ['颜色'],
        } }),
        streamedReply(misleading, call('read', 'get_board_snapshot', { range: 'viewport' })),
        streamedReply(misleading, call('ask', 'ask_user', { question: '矩形使用什么颜色？' })),
        streamedReply(misleading),
    ]
    configureModel(t, async () => {
        assert.ok(responses.length, '不应额外发起模型调用')
        return responses.shift()
    })
    const calls = [], steps = []
    const result = await streamBoardCreateRun({ roomId: 'room', prompt: '新增矩形，颜色先询问' },
        new AbortController().signal, async toolCall => {
            calls.push(toolCall.function.name)
            assert.equal(JSON.parse(toolCall.function.arguments).elements, undefined)
            return toolCall.function.name === 'get_board_snapshot'
                ? { ok: true, state: 'draft', range: 'viewport', truncated: false,
                    snapshot: { reference: { id: null, x: 0, y: 0 }, viewport: { x: 0, y: 0, w: 800, h: 600 }, shapes: [] } }
                : { ok: true, answer: '蓝色' }
        }, step => steps.push(step), browserFetch)
    assert.deepEqual(calls, ['get_board_snapshot', 'ask_user'])
    assert.equal(steps.filter(step => step.stage === 'call').length, 2)
    assert.equal(steps.filter(step => step.stage === 'text').length, 0, '模型原始文字不能进入页面正文')
    assert.equal(result.output, undefined)
    assert.equal(result.text, '本轮没有执行白板修改。')
    assert.equal(traces.at(-1).events.filter(event => event.type === 'model_response' && event.data.content === misleading).length, 3)
})

test('白板入口的普通回复仍正常返回正文', async t => {
    configureModel(t, async () => jsonReply({ kind: 'reply', text: '你好' }))
    const result = await streamBoardCreateRun({ roomId: 'room', prompt: '你好' }, new AbortController().signal,
        () => assert.fail('普通回复不能调用白板工具'), () => {}, browserFetch)
    assert.equal(result.text, '你好')
    assert.equal(result.output, undefined)
})
