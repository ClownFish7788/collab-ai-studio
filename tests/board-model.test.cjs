const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createChatCompletionsModel } = require('../src/agent/adapters/model/chatCompletions.ts')
const { createBoardToolContracts } = require('../src/agent/domain/tool.ts')

const contracts = createBoardToolContracts(['geo'])
const config = { apiKey: 'test-key', model: 'board-model', baseUrl: 'https://model.test/v1' }
const signal = () => new AbortController().signal
const context = messages => ({ runId: 'test-run', messages, toolResults: [] })
const prompt = [{ role: 'user', content: [{ type: 'text', source: 'user', text: '画一个矩形' }] }]
const chunk = (delta, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] })
const textFrames = text => [chunk({ role: 'assistant', content: text }), chunk({}, 'stop')]
const toolFrames = (name, args, id = 'call-1') => [
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }] }),
    chunk({}, 'tool_calls'),
]
function stream(frames, done = true) {
    const text = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '')
    const bytes = new TextEncoder().encode(text)
    return new Response(new ReadableStream({
        start(controller) {
            // Split inside JSON and UTF-8 characters, rather than assuming one frame per network chunk.
            for (let start = 0; start < bytes.length; start += 17) controller.enqueue(bytes.slice(start, start + 17))
            controller.close()
        },
    }), { headers: { 'content-type': 'text/event-stream' } })
}
function model(response, options = {}) {
    return createChatCompletionsModel({ config, contracts, fetcher: async () => response, ...options })
}

test('OpenAI preparation uses its token field and omits tool settings when no tools are offered', async () => {
    let body
    const adapter = model(stream(textFrames('准备完成')), {
        config: { ...config, provider: 'openai' },
        fetcher: async (_url, init) => { body = JSON.parse(init.body); return stream(textFrames('准备完成')) },
    })
    assert.equal(await adapter.prepare(prompt, signal()), '准备完成')
    assert.equal(body.max_completion_tokens, 2000)
    assert.equal(body.max_tokens, undefined)
    assert.equal(body.enable_thinking, undefined)
    assert.equal(body.tools, undefined)
    assert.equal(body.tool_choice, undefined)
    assert.equal(body.parallel_tool_calls, undefined)
})

test('OpenAI execution sends only allowed function schemas and returns domain tool decisions', async () => {
    let body
    const adapter = model(null, {
        config: { ...config, provider: 'openai' },
        fetcher: async (_url, init) => { body = JSON.parse(init.body); return stream(toolFrames('get_board_snapshot', '{"range":"page"}')) },
    })
    const decision = await adapter.next(context(prompt), ['get_board_snapshot'], signal())
    assert.equal(body.max_completion_tokens, 4000)
    assert.equal(body.enable_thinking, undefined)
    assert.deepEqual(body.tools.map(tool => tool.function.name), ['get_board_snapshot'])
    assert.equal(body.tool_choice, 'auto')
    assert.equal(body.parallel_tool_calls, true)
    assert.deepEqual(decision.calls, [{ id: 'call-1', name: 'get_board_snapshot', input: { range: 'page' } }])
})

test('Qwen defaults and split tool-argument previews survive the transport migration', async () => {
    const previews = []
    let body
    const adapter = model(null, {
        onPreview: (...args) => previews.push(args),
        fetcher: async (_url, init) => {
            body = JSON.parse(init.body)
            return stream([
                chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'get_board_snapshot', arguments: '{"range":' } }] }),
                chunk({ tool_calls: [{ index: 0, id: '', function: { arguments: '"page"}' } }] }),
                chunk({}, 'tool_calls'),
            ])
        },
    })
    const decision = await adapter.next(context(prompt), ['get_board_snapshot'], signal())
    assert.equal(body.enable_thinking, false)
    assert.equal(body.max_tokens, 4000)
    assert.deepEqual(decision.calls[0].input, { range: 'page' })
    assert.deepEqual(previews, [['tool', '{"range":', true], ['tool', '"page"}', false]])
})

for (const [name, frames, done] of [
    ['missing DONE', textFrames('unfinished'), false],
    ['missing finish reason', [chunk({ role: 'assistant', content: 'unfinished' })], true],
    ['token limit finish', [chunk({ role: 'assistant', content: 'unfinished' }, 'length')], true],
    ['oversized text', textFrames('x'.repeat(8001)), true],
    ['unoffered tool', toolFrames('delete_shapes', '{"targets":[]}'), true],
    ['reused tool call IDs', [chunk({ role: 'assistant', tool_calls: [0, 1].map(index => ({ index, id: 'same-id', type: 'function', function: { name: 'get_board_snapshot', arguments: '{"range":"page"}' } })) }), chunk({}, 'tool_calls')], true],
]) test(`board rejects ${name} before producing a usable decision`, async () => {
    await assert.rejects(model(stream(frames, done)).next(context(prompt), ['get_board_snapshot'], signal()), error => {
        assert.equal(error.detail.code, 'INVALID_MODEL_RESPONSE')
        return true
    })
})

test('complete array strings are repaired while truncated arrays remain invalid input', async () => {
    for (const [raw, repaired] of [["[{objectKey:'box',type:'geo',x:0,y:0,}]", true], ['[{"objectKey":"box"', false]]) {
        const args = JSON.stringify({ shapes: raw, isFinal: true })
        const decision = await model(stream(toolFrames('create_shapes', args))).next(context(prompt), ['create_shapes'], signal())
        if (repaired) assert.deepEqual(decision.calls[0].input.shapes, [{ objectKey: 'box', type: 'geo', x: 0, y: 0 }])
        else assert.equal(decision.calls[0].input.shapes, raw)
    }
})

test('malformed outer tool JSON is preserved for application-level correction', async () => {
    const raw = '{"range":'
    const decision = await model(stream(toolFrames('get_board_snapshot', raw))).next(context(prompt), ['get_board_snapshot'], signal())
    assert.equal(decision.calls[0].input, raw)
})

test('JSON response fallback still yields a domain decision', async () => {
    const response = Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '完成' } }] })
    assert.deepEqual(await model(response).next(context(prompt), ['get_board_snapshot'], signal()), { kind: 'text', text: '完成' })
})

test('tool screenshots and user answer images follow every result in their tool batch', async () => {
    const messages = [
        ...prompt,
        { role: 'assistant', content: [], calls: [
            { id: 'shot', name: 'get_board_screenshot', input: { range: 'page' } },
            { id: 'ask', name: 'ask_user', input: { question: '用哪张图？' } },
        ] },
        { role: 'tool', callId: 'shot', name: 'get_board_screenshot', state: 'known', ok: true, content: [
            { type: 'data', source: 'tool', data: { ok: true } }, { type: 'image', source: 'tool', url: 'data:image/png;base64,AAAA' },
        ] },
        { role: 'tool', callId: 'ask', name: 'ask_user', state: 'known', ok: true, content: [
            { type: 'text', source: 'user', text: '这张' }, { type: 'image', source: 'user', url: 'data:image/png;base64,BBBB' },
        ] },
    ]
    const original = structuredClone(messages)
    let encoded
    const adapter = model(null, { fetcher: async (_url, init) => { encoded = JSON.parse(init.body).messages; return stream(textFrames('已观察')) } })
    await adapter.next(context(messages), ['get_board_snapshot'], signal())
    const tools = encoded.filter(message => message.role === 'tool')
    assert.deepEqual(tools.map(message => message.tool_call_id), ['shot', 'ask'])
    assert.deepEqual(JSON.parse(tools[1].content).answer, { text: '这张', images: ['[image supplied below]'] })
    const lastTool = encoded.findLastIndex(message => message.role === 'tool')
    const images = encoded.filter(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'))
    assert.equal(images.length, 2)
    assert.ok(images.every(message => encoded.indexOf(message) > lastTool))
    assert.deepEqual(messages, original)
})

test('provider authentication failures remain model failures with safe status diagnostics', async () => {
    for (const status of [401, 403]) {
        const adapter = model(null, { fetcher: async () => Response.json({ error: { message: 'secret-provider-body' } }, { status }) })
        await assert.rejects(adapter.next(context(prompt), ['get_board_snapshot'], signal()), error => {
            assert.equal(error.detail.code, 'INVALID_MODEL_RESPONSE')
            assert.match(error.message, new RegExp(`HTTP ${status}`))
            assert.equal(error.status, undefined)
            assert.ok(!error.message.includes('secret-provider-body'))
            return true
        })
    }
})

test('cancelling while reading a board stream preserves cancellation and stops the reader', async () => {
    const controller = new AbortController()
    const reason = new DOMException('deadline', 'TimeoutError')
    let cancelled = false
    const response = new Response(new ReadableStream({
        start(streamController) { streamController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk({ role: 'assistant', content: 'preview' }))}\n\n`)) },
        cancel() { cancelled = true },
    }), { headers: { 'content-type': 'text/event-stream' } })
    const adapter = model(response, { onPreview: () => controller.abort(reason) })
    await assert.rejects(adapter.prepare(prompt, controller.signal), error => error === reason)
    assert.equal(cancelled, true)
})
