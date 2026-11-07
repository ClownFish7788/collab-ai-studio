const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createChatCompletionsModel } = require('../src/agent/adapters/model/chatCompletions.ts')
const { createBoardToolContracts } = require('../src/agent/domain/tool.ts')
const { prepareTask } = require('../src/agent/application/prepareTask.ts')

const contracts = createBoardToolContracts(['geo'])
const prompt = [{ role: 'user', content: [{ type: 'text', source: 'user', text: '你好' }] }]
const signal = () => new AbortController().signal
let sequence = 0
const settings = () => ({ apiKey: 'fallback-test-key', provider: 'openai', model: `fallback-${sequence++}`, baseUrl: 'https://fallback.test/v1' })
const reply = '{"kind":"reply","brief":null,"text":"你好"}'
const stream = (text = reply, finish = 'stop', done = true) => new Response(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: finish }] })}\n\n${done ? 'data: [DONE]\n\n' : ''}`,
    { headers: { 'content-type': 'text/event-stream' } },
)
const unsupported = (mode, status = 400) => new Response(JSON.stringify({ error: {
    code: 'unsupported_value', param: 'response_format', message: `response_format of type '${mode}' is not supported with this model`,
} }), { status, headers: { 'content-type': 'application/json' } })
function adapter(config, handler, requests = [], options = {}) {
    return createChatCompletionsModel({ config, contracts, ...options, fetcher: async (_url, init) => {
        const body = JSON.parse(init.body)
        requests.push(body)
        return handler(body, requests.length, init.signal)
    } })
}
const formats = requests => requests.map(body => body.response_format?.type ?? 'prompt')

test('preparation starts strict and subsequent requests reuse a confirmed downgrade', async () => {
    const config = settings(), requests = []
    const model = adapter(config, body => body.response_format?.type === 'json_schema' ? unsupported('json_schema') : stream(), requests)
    assert.equal(await model.prepare(prompt, signal()), '{"kind":"reply","text":"你好"}')
    await model.prepare(prompt, signal())
    await adapter(config, () => stream(), requests).prepare(prompt, signal())
    assert.deepEqual(formats(requests), ['json_schema', 'json_object', 'json_object', 'json_object'])
    assert.equal(requests[0].response_format.json_schema.strict, true)
})

test('schema and object rejection fall back to prompt and stay within four physical requests', async () => {
    const requests = []
    const model = adapter(settings(), body => body.response_format ? unsupported(body.response_format.type) : stream(), requests)
    await model.prepare(prompt, signal())
    await model.prepare(prompt, signal())
    await assert.rejects(model.prepare(prompt, signal()))
    assert.deepEqual(formats(requests), ['json_schema', 'json_object', 'prompt', 'prompt'])
    assert.ok(requests.every(body => JSON.stringify(body.messages).includes('JSON')))
})

test('the physical request ceiling still holds if capabilities expire after a failed negotiation', async t => {
    let now = 1000
    t.mock.method(Date, 'now', () => now)
    const requests = [], events = []
    const model = adapter(settings(), body => body.response_format ? unsupported(body.response_format.type) : unsupported('json_schema', 500), requests, {
        record: async (_type, data) => events.push(data),
    })
    await assert.rejects(model.prepare(prompt, signal()))
    now += 3600000
    await assert.rejects(model.prepare(prompt, signal()), cause => {
        assert.match(cause.detail.message, /请求预算/)
        return true
    })
    assert.equal(requests.length, 4)
    assert.equal(events.at(-1).willFallback, false)
})

for (const status of [401, 403, 404, 429, 500]) test(`HTTP ${status} never downgrades or poisons capabilities`, async () => {
    const config = settings(), requests = []
    await assert.rejects(adapter(config, () => unsupported('json_schema', status), requests).prepare(prompt, signal()))
    await adapter(config, () => stream(), requests).prepare(prompt, signal())
    assert.deepEqual(formats(requests), ['json_schema', 'json_schema'])
})

test('invalid schema and unknown 400 do not downgrade or poison capabilities', async () => {
    for (const error of [
        { code: 'invalid_json_schema', message: 'Invalid schema' },
        { code: 'InvalidParameter', message: 'invalid response_format' },
        { code: 'unsupported_parameter', message: "Unsupported parameter: 'response_format.json_schema.schema.patternProperties'." },
    ]) {
        const config = settings(), requests = []
        await assert.rejects(adapter(config, () => new Response(JSON.stringify({ error }), { status: 400 }), requests).prepare(prompt, signal()))
        await adapter(config, () => stream(), requests).prepare(prompt, signal())
        assert.deepEqual(formats(requests), ['json_schema', 'json_schema'])
    }
})

test('application correction reuses the accepted format without negotiation', async () => {
    const requests = []
    const model = adapter(settings(), (body, count) => count === 1 ? unsupported('json_schema') : stream(count === 2 ? '{"kind":' : reply), requests)
    const result = await prepareTask(prompt, { model, signal: signal(), checkAccess: async () => {} })
    assert.deepEqual(result, { kind: 'reply', text: '你好' })
    assert.deepEqual(formats(requests), ['json_schema', 'json_object', 'json_object'])
})

test('a format rejected on correction terminates instead of restarting negotiation', async () => {
    const requests = []
    const model = adapter(settings(), (_body, count) => count === 1 ? stream('{"kind":') : unsupported('json_schema'), requests)
    await assert.rejects(prepareTask(prompt, { model, signal: signal(), checkAccess: async () => {} }))
    assert.deepEqual(formats(requests), ['json_schema', 'json_schema'])
})

test('stream truncation and refusal do not replay or downgrade an accepted HTTP response', async () => {
    for (const response of [stream('partial', 'stop', false), stream('partial', 'length'), new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: null, refusal: 'no' } }] }))]) {
        const requests = []
        await assert.rejects(adapter(settings(), () => response, requests).prepare(prompt, signal()))
        assert.deepEqual(formats(requests), ['json_schema'])
    }
})

test('abort between attempts preserves cancellation and prevents the next HTTP request', async () => {
    const controller = new AbortController(), reason = new DOMException('deadline', 'TimeoutError'), requests = []
    const model = adapter(settings(), () => { controller.abort(reason); return unsupported('json_schema') }, requests)
    await assert.rejects(model.prepare(prompt, controller.signal), cause => cause === reason)
    assert.equal(requests.length, 1)
})

test('execution does not inherit preparation response_format or its fallback loop', async () => {
    const requests = []
    const model = adapter(settings(), () => unsupported('json_schema'), requests)
    await assert.rejects(model.next({ runId: 'run', messages: prompt, toolResults: [] }, ['get_board_snapshot'], signal()))
    assert.deepEqual(formats(requests), ['prompt'])
    assert.ok(requests[0].tools)
})

test('preparation records safe format acceptance and rejection with the physical attempt number', async () => {
    const events = [], requests = []
    const model = adapter(settings(), body => body.response_format?.type === 'json_schema' ? unsupported('json_schema') : stream(), requests, {
        record: async (type, data) => events.push({ type, data }),
    })
    await model.prepare(prompt, signal())
    assert.deepEqual(events.map(event => [event.type, event.data.operation, event.data.mode, event.data.attempt, event.data.outcome, event.data.willFallback]), [
        ['operation_result', 'preparation_format', 'schema', 1, 'error', true],
        ['operation_result', 'preparation_format', 'object', 2, 'success', false],
    ])
    assert.equal(events[0].data.reason, 'unsupported_output_format')
    assert.equal(events[0].data.diagnostic.code, 'unsupported_value')
    assert.equal(events[1].data.accepted, true)
    assert.ok(!JSON.stringify(events).includes('fallback-test-key'))
    assert.ok(!JSON.stringify(events).includes('is not supported with this model'))
})

test('trace observer failures never change request count, output or mode selection', async () => {
    const requests = []
    let reports = 0
    const model = adapter(settings(), body => body.response_format?.type === 'json_schema' ? unsupported('json_schema') : stream(), requests, {
        record: async () => { reports++; throw new Error('trace storage offline') },
    })
    await model.prepare(prompt, signal())
    assert.deepEqual(formats(requests), ['json_schema', 'json_object'])
    assert.equal(reports, 2)
})
