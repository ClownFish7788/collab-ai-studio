const assert = require('node:assert/strict')
const { test } = require('node:test')
const Module = require('node:module')
const { requestBoardCreateModel } = require('../src/lib/boardCreateModel.ts')
const { streamBoardCreateRun } = require('../src/utils/board/agent/streamBoardCreateRun.ts')

let userId = crypto.randomUUID()
const traces = []
const access = { check: async () => {} }
class CreateAccessError extends Error {
    constructor(message, status) { super(message); this.status = status }
}
// Only replace authentication and trace storage; run the real route, model adapter and tool loop.
const load = Module._load
let POST, POSTResult
try {
    Module._load = function (name, ...args) {
        if (name === '@/lib/boardCreateAccess') return {
            CreateAccessError,
            requireCreateUser: async () => userId,
            requireCreateAccess: (...args) => access.check(...args),
            readCreatePayload: request => request.json(),
        }
        if (name === '@/lib/prisma') return { agentTrace: { findUnique: async () => ({ userId }) } }
        if (name === '@/lib/agentTrace') return {
            appendAgentTraceEvent: async (id, type, data) => traces.find(trace => trace.id === id)?.events.push({ type, data }),
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
    ;({ POST: POSTResult } = require('../src/app/api/board-create/[runId]/result/route.ts'))
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
    userId = crypto.randomUUID()
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
        return POSTResult(new Request(`https://app.test${url}`, init), { params: Promise.resolve({ runId: result[1] }) })
    }
    return Response.json({ accepted: true })
}

test('执行模型没有开放工具时直接拒绝，不再保留无工具总结请求', async () => {
    await assert.rejects(requestBoardCreateModel([], { apiKey: 'test', model: 'test', baseUrl: 'https://model.test' },
        new AbortController().signal, [], async () => assert.fail('不能发起无工具的执行模型请求')),
    /没有可调用的工具/)
})

for (const revoked of [false, true]) test(`真实结果接口${revoked ? '拒绝失去权限的结果' : '验收写入后直接结束，不再复核下一轮权限'}`, async t => {
    const shape = { type: 'geo', x: 0, y: 0 }
    let requests = 0, toolExecuted = false
    const steps = []
    configureModel(t, async () => {
        assert.ok(++requests <= 2, '不能再请求模型总结')
        return requests === 1 ? jsonReply({ kind: 'task', brief: {
            goal: '新增矩形', tasks: ['新增矩形'], objects: [{ key: 'box', role: '矩形', description: '待新增' }],
            relations: [], constraints: [], unresolvedQuestions: [],
        } }) : streamedReply('', { id: 'create', type: 'function', function: {
            name: 'create_shapes', arguments: JSON.stringify({ shapes: [shape], elements: [
                { key: 'box', operation: 'create', type: 'geo', known: {}, missing: [] },
            ] }),
        } })
    })
    let resultAccessChecks = 0
    t.mock.method(access, 'check', async () => {
        assert.equal(traces.at(-1).events.some(event => event.type === 'tool_result'), false,
            '已验收写入后不能再运行下一轮权限检查')
        if (toolExecuted) {
            resultAccessChecks++
            if (revoked) throw new CreateAccessError('当前没有编辑权限', 403)
        }
    })
    const output = { ok: true, state: 'draft', shapes: [{ ...shape, id: 'shape:new' }] }
    const work = streamBoardCreateRun({ roomId: 'room', prompt: '新增矩形', snapshot: {
        reference: { id: null, x: 0, y: 0 }, viewport: { x: 0, y: 0, w: 800, h: 600 }, shapes: [],
    } }, new AbortController().signal, () => { toolExecuted = true; return output }, step => steps.push(step), browserFetch)
    if (revoked) {
        await assert.rejects(work, /当前没有编辑权限/)
        assert.equal(steps.some(step => step.stage === 'summary'), false)
        assert.equal(traces.at(-1).events.some(event => event.type === 'tool_result'), false)
    } else {
        assert.deepEqual((await work).output, output)
        assert.equal(steps.find(step => step.stage === 'result').message, '提交真实结果，等待后端确认')
    }
    assert.equal(resultAccessChecks, 1, '结果回传仍必须独立复核权限')
    assert.equal(requests, 2)
})

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

test('需求与工具参数分片先到达预览，完整工具参数仍须等流结束才执行', async t => {
    const encoder = new TextEncoder(), controller = new AbortController()
    let preparationStream, toolStream, requests = 0, executions = 0
    const pendingStream = register => new Response(new ReadableStream({ start: register }), { headers: { 'Content-Type': 'text/event-stream' } })
    configureModel(t, async () => {
        if (++requests === 1) return pendingStream(stream => { preparationStream = stream })
        if (requests === 2) return pendingStream(stream => { toolStream = stream })
        return streamedReply('已经完成')
    })
    const steps = []
    const work = streamBoardCreateRun({ roomId: 'room', prompt: '读取白板' }, controller.signal, () => {
        executions++
        return { ok: true, state: 'draft', range: 'viewport', truncated: false,
            snapshot: { reference: { id: null, x: 0, y: 0 }, viewport: { x: 0, y: 0, w: 800, h: 600 }, shapes: [] } }
    }, step => steps.push(step), browserFetch)
    work.catch(() => {})
    const send = (stream, delta, finish = null) => stream.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`))
    try {
        await new Promise(resolve => setImmediate(resolve))
        send(preparationStream, { role: 'assistant', content: '{"kind":"task","brief":{"goal":"读取当前' })
        await new Promise(resolve => setImmediate(resolve))
        assert.ok(steps.some(step => step.stage === 'preview' && step.message.includes('读取当前')), '第一段 JSON 到达就应显示文字')
        assert.equal(requests, 1)
        assert.equal(executions, 0)
        send(preparationStream, { content: '白板","tasks":["读取"],"objects":[],"relations":[],"constraints":[],"unresolvedQuestions":[]}}' }, 'stop')
        preparationStream.enqueue(encoder.encode('data: [DONE]\n\n')); preparationStream.close()
        await new Promise(resolve => setImmediate(resolve))
        send(toolStream, { role: 'assistant', tool_calls: [{ index: 0, id: 'read-stream', type: 'function', function: {
            name: 'get_board_snapshot', arguments: '{"range":"viewport","elements":[{"key":"board","role":"读取范围","operation":"reference","known":{},"missing":[]}',
        } }] })
        await new Promise(resolve => setImmediate(resolve))
        assert.ok(steps.some(step => step.stage === 'preview' && step.message.includes('board')), '完整表行应在整个参数收完前可见')
        assert.equal(executions, 0)
        send(toolStream, { tool_calls: [{ index: 0, function: { arguments: ']}' } }] })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(executions, 0, '完整 JSON 尚未结束响应，不能执行')
        send(toolStream, {}, 'tool_calls')
        toolStream.enqueue(encoder.encode('data: [DONE]\n\n')); toolStream.close()
        const result = await work
        assert.equal(executions, 1)
        assert.equal(requests, 3, '预览不增加模型调用')
        assert.equal(result.text, '本轮没有执行白板修改。')
    } finally {
        controller.abort()
        await work.catch(() => {})
    }
})

test('生成预览后收到非法 JSON，不能执行工具或报告正常完成', async t => {
    configureModel(t, async () => streamedReply('{"kind":"task","brief":{"goal":"画圆"},broken}'))
    const steps = []
    await assert.rejects(streamBoardCreateRun({ roomId: 'room', prompt: '画圆' }, new AbortController().signal,
        () => assert.fail('非法 JSON 的预览不能触发工具'), step => steps.push(step), browserFetch))
    assert.ok(steps.some(step => step.stage === 'preview' && step.message.includes('画圆')))
    assert.equal(steps.some(step => step.stage === 'summary'), false)
})

test('预览期间取消任务，后续内容不能执行工具', async t => {
    const controller = new AbortController()
    configureModel(t, async () => new Response(new ReadableStream({ start(stream) {
        const frame = { choices: [{ index: 0, delta: { role: 'assistant', content: '{"brief":{"goal":"画圆' }, finish_reason: null }] }
        stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
    } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    let sawPreview = false
    await assert.rejects(streamBoardCreateRun({ roomId: 'room', prompt: '画圆' }, controller.signal,
        () => assert.fail('取消后不能执行工具'), step => {
            if (step.stage === 'preview') { sawPreview = true; controller.abort() }
        }, browserFetch))
    assert.equal(sawPreview, true)
})

test('纠错请求的 JSON 预览重新开始，不拼接前一次参数', async t => {
    const call = (id, known) => ({ id, type: 'function', function: {
        name: 'get_board_snapshot', arguments: JSON.stringify({ range: 'viewport', elements: [{
            key: id, role: '读取范围', operation: 'reference', known, missing: [],
        }] }),
    } })
    const responses = [
        jsonReply({ kind: 'task', brief: { goal: '读取白板', tasks: ['读取'], objects: [], relations: [], constraints: [], unresolvedQuestions: [] } }),
        streamedReply('', call('first_attempt', undefined)),
        streamedReply('', call('second_attempt', {})),
        streamedReply('已读取'),
    ]
    configureModel(t, async () => responses.shift())
    const steps = []
    let executions = 0
    await streamBoardCreateRun({ roomId: 'room', prompt: '读取白板' }, new AbortController().signal, () => {
        executions++
        return { ok: true, state: 'draft', range: 'viewport', truncated: false,
            snapshot: { reference: { id: null, x: 0, y: 0 }, viewport: { x: 0, y: 0, w: 800, h: 600 }, shapes: [] } }
    }, step => steps.push(step), browserFetch)
    const previews = steps.filter(step => step.stage === 'preview').map(step => step.message)
    assert.ok(previews.some(text => text.includes('first_attempt')))
    assert.ok(previews.some(text => text.includes('second_attempt')))
    assert.equal(previews.some(text => text.includes('first_attempt') && text.includes('second_attempt')), false)
    assert.equal(executions, 1)
})

test('网络字节分片切在中文与 emoji 内部时，预览和最终回复都不丢字', async t => {
    const text = '中文回复🙂'
    const frame = { choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify({ kind: 'reply', text }) }, finish_reason: 'stop' }] }
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`)
    configureModel(t, async () => new Response(new ReadableStream({ start(stream) {
        for (const byte of bytes) stream.enqueue(Uint8Array.of(byte))
        stream.close()
    } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const steps = []
    const result = await streamBoardCreateRun({ roomId: 'room', prompt: '你好' }, new AbortController().signal,
        () => assert.fail('普通回复不能执行工具'), step => steps.push(step), browserFetch)
    assert.equal(result.text, text)
    assert.ok(steps.some(step => step.stage === 'preview' && step.message === text))
})
