const assert = require('node:assert/strict')
const { test } = require('node:test')
const { beginCreateRun, runCreateLoop, submitCreateResult, getOwnedCreateRun } = require('../src/lib/boardCreateRun.ts')
const { requestBoardTaskBrief } = require('../src/lib/boardCreateModel.ts')
const { observeModelFetch, serializeTraceData } = require('../src/lib/modelTrace.ts')
const { buildTraceFlow } = require('../src/utils/agent-traces/flow.ts')
const { eventOutcome } = require('../src/utils/agent-traces/outcomes.ts')
const { BoardProtocolError } = require('../src/utils/board/agent/boardCreateProtocol.ts')
const { streamBoardCreateRun } = require('../src/utils/board/agent/streamBoardCreateRun.ts')
const { prepareElementTableCall } = require('../src/utils/board/agent/boardElementTable.ts')

const request = { roomId: 'room', prompt: '新增一个矩形' }
const preparation = { kind: 'task', brief: {
    goal: '新增一个矩形', tasks: ['读取白板', '新增矩形'],
    objects: [{ key: 'box', role: '矩形', description: '一个矩形' }],
    relations: [], constraints: [], unresolvedQuestions: [],
} }
const row = { key: 'box', operation: 'reference', known: {}, missing: [{ field: 'x', source: 'read' }] }
const snapshot = { reference: { id: null, x: 0, y: 0 }, viewport: { x: 0, y: 0, w: 800, h: 600 }, shapes: [] }
const makeCall = (id, elements) => ({ id, type: 'function', function: {
    name: 'get_board_snapshot', arguments: JSON.stringify({ range: 'viewport', elements }),
} })
const newRun = () => beginCreateRun(crypto.randomUUID(), 'room', new AbortController().signal)
function capture() {
    const events = []
    return { events, record: async (type, data, durationMs) => { events.push({ type, data, durationMs }) } }
}
const operation = (events, name) => events.find(event => event.data.operation === name)

test('需求拆分直接回复也记录结果、耗时及原始模型交互，不启动执行模型', async () => {
    const run = newRun(), { events, record } = capture(), emitted = []
    const reply = { kind: 'reply', text: '你好' }
    const fetcher = observeModelFetch(record, async () => Response.json({ choices: [{
        message: { role: 'assistant', content: JSON.stringify(reply) }, finish_reason: 'stop',
    }] }))
    await runCreateLoop(run, request, async () => assert.fail('不能进入执行模型'), event => emitted.push(event), async () => {},
        messages => requestBoardTaskBrief(messages, { apiKey: 'test', model: 'test', baseUrl: 'https://model.test' }, run.signal, fetcher), 100, record)
    assert.equal(events.filter(event => event.type === 'model_request').length, 1)
    assert.equal(events.find(event => event.type === 'model_response').data.status, 'completed')
    const result = operation(events, 'task_preparation')
    assert.ok(result, '缺少需求拆分埋点')
    assert.equal(result.data.outcome, 'success')
    assert.deepEqual(result.data.preparation, reply)
    assert.ok(result.durationMs >= 0)
    assert.equal(emitted.at(-1).text, '你好')
    assert.throws(() => getOwnedCreateRun(run.id, run.ownerId))
})

for (const kind of ['invalid', 'network', 'cancelled', 'timeout']) test(`需求拆分 ${kind} 记录分类错误且不执行工具`, async () => {
    const run = newRun(), { events, record } = capture()
    await assert.rejects(runCreateLoop(run, request, async () => assert.fail('不能进入执行模型'), async () => {}, async () => {}, async () => {
        if (kind === 'invalid') return { kind: 'task', brief: {} }
        if (kind === 'cancelled' || kind === 'timeout') {
            run.controller.abort(new DOMException(kind, kind === 'timeout' ? 'TimeoutError' : 'AbortError'))
            return preparation
        }
        throw new TypeError('fetch failed')
    }, 100, record))
    const result = operation(events, 'task_preparation')
    assert.ok(result, '异常路径缺少需求拆分埋点')
    assert.equal(result.data.outcome, kind === 'cancelled' ? 'cancelled' : 'error')
    assert.equal(eventOutcome(result.type, result.data).errorCategory,
        { invalid: 'model', network: 'model', cancelled: 'cancelled', timeout: 'timeout' }[kind])
    assert.ok(result.durationMs >= 0)
    assert.equal(events.some(event => event.type === 'tool_call'), false)
    assert.throws(() => getOwnedCreateRun(run.id, run.ownerId))
})

test('需求拆分埋点写入期间超时不能将直接回复标记为已完成', async () => {
    const run = newRun(), emitted = []
    const reason = new DOMException('记录期间超时', 'TimeoutError')
    await assert.rejects(runCreateLoop(run, request, async () => assert.fail('不能进入执行模型'), event => emitted.push(event),
        async () => {}, async () => ({ kind: 'reply', text: '你好' }), 100, async (_type, data) => {
            if (data.operation === 'task_preparation' && data.outcome === 'success') run.controller.abort(reason)
        }), cause => cause === reason)
    assert.deepEqual(emitted.map(event => event.type), ['started'])
    assert.throws(() => getOwnedCreateRun(run.id, run.ownerId))
})

test('元素表纠错保留失败现场，成功记录原始调用、原生调用及表格，并按真实顺序进入后台流程', async () => {
    const run = newRun(), { events, record } = capture(), emitted = []
    let attempt = 0
    await runCreateLoop(run, request, async (_messages, _allowed, keys) => {
        assert.deepEqual(keys, ['box'])
        if (++attempt === 1) return { kind: 'tool', call: makeCall('bad', []) }
        if (attempt === 2) return { kind: 'tool', call: makeCall('good', [row]) }
        return { kind: 'text', text: '已读取' }
    }, event => {
        emitted.push(event)
        if (event.type === 'tool') {
            assert.deepEqual(JSON.parse(event.call.function.arguments), { range: 'viewport' })
            submitCreateResult(run.id, run.ownerId, event.call.id,
                { ok: true, state: 'draft', range: 'viewport', snapshot, truncated: false })
        }
    }, async () => {}, async () => preparation, 100, record)
    const elements = events.filter(event => event.data.operation === 'element_preparation')
    assert.equal(elements.length, 2, '每次元素预处理都必须记录')
    assert.equal(elements[0].data.outcome, 'error')
    assert.equal(elements[0].data.willRetry, true)
    assert.equal(elements[0].data.modelCall.id, 'bad')
    assert.equal(eventOutcome(elements[0].type, elements[0].data).errorCategory, 'validation')
    assert.equal(elements[1].data.outcome, 'success')
    assert.deepEqual(elements[1].data.elements, [row])
    assert.deepEqual(JSON.parse(elements[1].data.modelCall.function.arguments).elements, [row])
    assert.deepEqual(JSON.parse(elements[1].data.call.function.arguments), { range: 'viewport' })
    assert.ok(elements.every(event => event.durationMs >= 0))
    assert.equal(emitted.filter(event => event.type === 'plan').length, 2)
    assert.equal(events.filter(event => event.type === 'tool_call').length, 1)
    const flow = buildTraceFlow({ status: 'completed', createdAt: new Date().toISOString(), events: events.map((event, index) => ({
        ...event, id: String(index), sequence: index, data: serializeTraceData(event.data),
    })) })
    assert.deepEqual(flow.filter(node => ['需求拆分', '元素预处理'].includes(node.label)).map(node => [node.label, node.status]),
        [['需求拆分', 'completed'], ['元素预处理', 'failed'], ['元素预处理', 'completed']])
    assert.equal(flow.find(node => node.kind === 'tool').status, 'completed')
})

test('元素表连续无效时仅纠错一次，两次失败均留痕且不下发工具', async () => {
    const run = newRun(), { events, record } = capture()
    await assert.rejects(runCreateLoop(run, request, async () => ({ kind: 'tool', call: makeCall('bad', []) }),
        event => assert.notEqual(event.type, 'tool'), async () => {}, async () => preparation, 100, record), BoardProtocolError)
    const failures = events.filter(event => event.data.operation === 'element_preparation')
    assert.deepEqual(failures.map(event => [event.data.outcome, event.data.willRetry]), [['error', true], ['error', false]])
})

for (const name of ['get_board_snapshot', 'ask_user']) test(`${name} 漏填 known 时先给出具体纠错提示，补齐后才执行工具`, async () => {
    const run = newRun(), { events, record } = capture(), executed = []
    const args = name === 'get_board_snapshot' ? { range: 'viewport' } : { question: '矩形使用什么颜色？' }
    let attempt = 0
    await runCreateLoop(run, request, async messages => {
        if (++attempt === 3) return { kind: 'text', text: '本轮未写入' }
        const element = { ...row }
        if (attempt === 1) delete element.known
        else {
            assert.equal(executed.length, 0, '非法参数不能先执行再纠错')
            const failure = JSON.parse(messages.filter(message => message.role === 'tool').at(-1).content)
            assert.equal(failure.error.code, 'INVALID_ARGUMENTS')
            assert.equal(failure.error.issues[0].path, 'elements[0].known')
            assert.match(failure.error.issues[0].message, /缺少.*known/)
            assert.match(failure.error.issues[0].message, /known: \{\}/)
        }
        return { kind: 'tool', call: { id: `call-${attempt}`, type: 'function', function: {
            name, arguments: JSON.stringify({ ...args, elements: [element] }),
        } } }
    }, event => {
        if (event.type !== 'tool') return
        executed.push(event.call)
        assert.deepEqual(JSON.parse(event.call.function.arguments), args)
        submitCreateResult(run.id, run.ownerId, event.call.id, name === 'get_board_snapshot'
            ? { ok: true, state: 'draft', range: 'viewport', snapshot, truncated: false }
            : { ok: true, answer: '蓝色' })
    }, async () => {}, async () => preparation, 100, record)
    assert.equal(executed.length, 1)
    const checks = events.filter(event => event.data.operation === 'element_preparation')
    assert.deepEqual(checks.map(event => event.data.outcome), ['error', 'success'])
})

test('known 为 null、数组或嵌套对象时仍拒绝，不自动当作空对象', () => {
    for (const known of [null, [], { position: { x: 0 } }]) {
        assert.throws(() => prepareElementTableCall(makeCall('invalid-known', [{ ...row, known }]), preparation.brief, new Set()),
            error => error instanceof BoardProtocolError && error.detail.issues[0].path === 'elements[0].known')
    }
})

test('新增无需已有 ID；参照对象的 ID 和类型须在顶层，缺项一次列全', () => {
    const shape = { type: 'geo', x: 0, y: 132, props: { geo: 'rectangle', w: 100, h: 100 } }
    const created = { key: 'box', operation: 'create', type: 'geo', known: {}, missing: [] }
    const makeCreate = elements => ({ id: 'create', type: 'function', function: {
        name: 'create_shapes', arguments: JSON.stringify({ shapes: [shape], elements }),
    } })
    assert.deepEqual(JSON.parse(prepareElementTableCall(makeCreate([created]), preparation.brief, new Set()).call.function.arguments), { shapes: [shape] })
    const brief = { ...preparation.brief, objects: [
        { key: 'above', role: '上方图形', description: '只作参照' }, ...preparation.brief.objects,
    ] }
    const reference = { key: 'above', operation: 'reference', known: { shapeId: 'shape:above', 'props.geo': 'ellipse' }, missing: [] }
    const seen = new Set(['shape:above'])
    assert.throws(() => prepareElementTableCall(makeCreate([reference, created]), brief, seen), error => {
        assert.ok(error instanceof BoardProtocolError)
        assert.deepEqual(error.detail.issues.map(issue => issue.path), ['elements[0].type', 'elements[0].shapeId'])
        assert.match(error.detail.issues[1].message, /顶层.*shapeId/)
        assert.match(error.detail.issues[1].message, /known/)
        return true
    })
    const corrected = { ...reference, type: 'geo', shapeId: 'shape:above' }
    assert.deepEqual(JSON.parse(prepareElementTableCall(makeCreate([corrected, created]), brief, seen).call.function.arguments), { shapes: [shape] })
    assert.throws(() => prepareElementTableCall(makeCreate([{ ...corrected, shapeId: 'shape:unseen' }, created]), brief, seen), BoardProtocolError)
})

test('新增草稿保留元素表埋点，浏览器仅执行原生参数，最终输出匹配真实结果', async () => {
    const run = newRun(), { events, record } = capture(), emitted = []
    const shape = { type: 'geo', x: 10, y: 20, props: { w: 100, h: 80, geo: 'rectangle' } }
    const output = { ok: true, state: 'draft', shapes: [{ id: 'shape:created', ...shape }] }
    let attempts = 0
    await runCreateLoop(run, { ...request, snapshot }, async () => {
        assert.equal(++attempts, 1, '成功写入后不能再请求模型总结')
        return { kind: 'tool', call: {
            id: 'create', type: 'function', function: { name: 'create_shapes', arguments: JSON.stringify({
                shapes: [shape], elements: [{ key: 'box', operation: 'create', type: 'geo', known: {}, missing: [] }],
            }) },
        } }
    }, event => {
        emitted.push(event)
        if (event.type === 'tool') {
            assert.deepEqual(JSON.parse(event.call.function.arguments), { shapes: [shape] })
            submitCreateResult(run.id, run.ownerId, event.call.id, output)
        }
    }, async () => {
        assert.equal(events.some(event => event.type === 'tool_result'), false, '写入结果已验收，不应再运行下一轮模型的权限复核')
    }, async () => preparation, 100, record)
    assert.deepEqual(emitted.at(-1).output, output)
    assert.equal(emitted.at(-1).text, '已经执行草稿修改，请检查白板预览。')
    assert.deepEqual(events.find(event => event.type === 'tool_result').data.output, output)
    assert.equal(operation(events, 'element_preparation').data.elements[0].type, 'geo')
})

for (const operation of ['update', 'delete']) test(`${operation} 成功后直接用真实 output 结束，不再请求模型`, async () => {
    const run = newRun(), emitted = []
    const patch = { id: 'shape:box', type: 'geo', props: { color: 'blue' } }
    const args = operation === 'update' ? { shapes: [patch] } : { ids: ['shape:box'] }
    const output = operation === 'update' ? { ok: true, state: 'draft', operation, shapes: [patch] }
        : { ok: true, state: 'draft', operation, ids: ['shape:box'] }
    let requests = 0
    await runCreateLoop(run, { ...request, snapshot: { ...snapshot, shapes: [{
        id: 'shape:box', type: 'geo', x: 0, y: 0, w: 100, h: 100, text: '', opacity: 1,
        origin: { x: 0, y: 0 }, props: { geo: 'rectangle', w: 100, h: 100 },
    }] } }, async () => {
        assert.equal(++requests, 1, '成功写入后不能再调用模型')
        return { kind: 'tool', call: { id: operation, type: 'function', function: {
            name: `${operation}_shapes`, arguments: JSON.stringify({ ...args, elements: [{
                key: 'box', operation, type: 'geo', shapeId: 'shape:box', known: {}, missing: [],
            }] }),
        } } }
    }, event => {
        emitted.push(event)
        if (event.type === 'tool') submitCreateResult(run.id, run.ownerId, event.call.id, output)
    }, async () => {}, async () => preparation, 100)
    assert.equal(emitted.at(-1).type, 'completed')
    assert.deepEqual(emitted.at(-1).output, output)
    assert.equal(emitted.at(-1).text, '已经执行草稿修改，请检查白板预览。')
})

test('写入结果记录后取消，不能报告正常完成', async () => {
    const run = newRun(), emitted = []
    const shape = { type: 'geo', x: 0, y: 0 }
    await assert.rejects(runCreateLoop(run, { ...request, snapshot }, async () => ({ kind: 'tool', call: {
        id: 'create', type: 'function', function: { name: 'create_shapes', arguments: JSON.stringify({
            shapes: [shape], elements: [{ key: 'box', operation: 'create', type: 'geo', known: {}, missing: [] }],
        }) },
    } }), event => {
        emitted.push(event)
        if (event.type === 'tool') submitCreateResult(run.id, run.ownerId, event.call.id,
            { ok: true, state: 'draft', shapes: [{ ...shape, id: 'shape:new' }] })
    }, async () => {}, async () => preparation, 100,
    async type => {
        if (type === 'tool_result') run.controller.abort()
    }))
    assert.equal(emitted.some(event => event.type === 'completed'), false)
})

test('前端接收 plan 时保留 runId，错误展示字段问题并保留埋点分类', async () => {
    const reports = [], steps = []
    const error = { code: 'INVALID_ARGUMENTS', message: '元素表不合法', issues: [{ path: 'elements', message: '缺少对象' }] }
    const fetcher = async (url, init) => {
        if (url === '/api/board-create') return new Response([
            { type: 'started', runId: 'run-1' }, { type: 'plan', runId: 'run-1', text: '正在规划' }, { type: 'error', runId: 'run-1', error },
        ].map(event => JSON.stringify(event) + '\n').join(''), { headers: { 'Content-Type': 'application/x-ndjson', 'X-Agent-Trace-Id': 'run-1' } })
        reports.push(JSON.parse(init.body))
        return Response.json({ ok: true })
    }
    await assert.rejects(streamBoardCreateRun(request, new AbortController().signal, () => assert.fail('不能执行工具'),
        step => steps.push(step), fetcher), cause => cause instanceof BoardProtocolError && cause.message.includes('elements：缺少对象'))
    assert.equal(steps[0].runId, 'run-1')
    assert.equal(steps[1].stage, 'plan')
    assert.equal(reports.at(-1).error.code, 'INVALID_ARGUMENTS')
})
