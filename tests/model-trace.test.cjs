const { test } = require('node:test')
const assert = require('node:assert/strict')
const { serializeTraceData, observeModelFetch } = require('../src/lib/modelTrace.ts')

test('trace payloads omit image bytes and credential fields, preserving useful context and explicit limits', () => {
    const data = serializeTraceData({ prompt: '创建圆', api_key: 'secret', headers: { Authorization: 'Bearer secret' },
        images: ['data:image/png;base64,QUJD'], messages: [{ image_url: { url: 'data:image/jpeg;base64,QUJD' } }],
        huge: 'x'.repeat(2_000_000) })
    assert.match(data, /创建圆/)
    assert.match(data, /image\/png/)
    assert.match(data, /truncated/)
    assert.doesNotMatch(data, /QUJD|secret/)
    assert.ok(data.length < 1_100_000)
    assert.doesNotThrow(() => JSON.parse(data))
})

test('error messages and stacks redact bearer tokens, URL credentials and configured secrets', () => {
    const previous = process.env.API_KEY
    process.env.API_KEY = 'fixture-transport-secret'
    try {
        const saved = serializeTraceData({ message: 'Bearer private-token https://user:private-password@example.com/path?api_key=private-key fixture-transport-secret' })
        assert.doesNotMatch(saved, /private-token|private-password|private-key|fixture-transport-secret/)
        assert.match(saved, /redacted/)
    } finally { if (previous === undefined) delete process.env.API_KEY; else process.env.API_KEY = previous }
})

function fixtureFetch(raw, open = false, contentType = 'text/event-stream') {
    const bytes = new TextEncoder().encode(raw)
    return async () => new Response(new ReadableStream({ start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
        if (!open) controller.close()
    } }), { headers: { 'content-type': contentType } })
}
const init = { method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: '你好' }] }) }
const frame = value => `data: ${JSON.stringify(value)}\r\n\r\n`

test('stream observation preserves bytes across UTF-8/CRLF splits and aggregates reasoning, tools and usage', async () => {
    const events = [], ends = []
    const raw = frame({ choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '服务商返回的说明' } }] })
        + frame({ choices: [{ index: 0, delta: { content: '你好', tool_calls: [{ index: 0, id: 'c1', function: { name: 'ask_user', arguments: '{"text":' } }] } }] })
        + frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"哪个？"}' } }] }, finish_reason: 'tool_calls' }] })
        + frame({ choices: [], usage: { total_tokens: 42 } }) + 'data: [DONE]\r\n\r\n'
    const fetcher = observeModelFetch(async (...args) => events.push(args), fixtureFetch(raw), async end => ends.push(end))
    assert.equal(await (await fetcher('https://fixture.invalid', init)).text(), raw)
    assert.equal(events[0][0], 'model_request')
    const response = events.find(e => e[0] === 'model_response')[1]
    assert.equal(response.requestId, events[0][1].requestId)
    assert.equal(response.content, '你好')
    assert.equal(response.reasoning, '服务商返回的说明')
    assert.equal(response.toolCalls[0].function.arguments, '{"text":"哪个？"}')
    assert.equal(response.usage.total_tokens, 42)
    assert.equal(ends[0].status, 'completed')
})

test('cancelled and incomplete responses retain partial content with an honest status', async () => {
    const events = [], ends = []
    const raw = frame({ choices: [{ index: 0, delta: { content: 'partial' } }] })
    const fetcher = observeModelFetch(async (...args) => events.push(args), fixtureFetch(raw, true), async end => ends.push(end))
    const reader = (await fetcher('https://fixture.invalid', init)).body.getReader()
    for (let i = 0; i < Math.ceil(Buffer.byteLength(raw) / 7); i++) await reader.read()
    // Let stream prefetch enter its pending read before cancellation resolves that read as done.
    await new Promise(setImmediate)
    await reader.cancel()
    assert.equal(events.find(e => e[0] === 'model_response')[1].content, 'partial')
    assert.equal(ends[0].status, 'cancelled')
    const incomplete = []
    await (await observeModelFetch(async () => {}, fixtureFetch(raw), async e => incomplete.push(e))('https://fixture.invalid', init)).text()
    assert.equal(incomplete[0].status, 'failed')
})

test('provider errors fail, non-stream JSON is captured, and storage failure cannot change streamed bytes', async () => {
    const ends = []
    await (await observeModelFetch(async () => {}, fixtureFetch(frame({ error: { message: 'bad' } }) + 'data: [DONE]\n\n'), async e => ends.push(e))('https://fixture.invalid', init)).text()
    assert.equal(ends[0].status, 'failed')
    const raw = JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })
    const events = []
    assert.equal(await (await observeModelFetch(async (...e) => events.push(e), fixtureFetch(raw, false, 'application/json'))('https://fixture.invalid', init)).text(), raw)
    assert.equal(events[1][1].content, 'ok')
    const broken = observeModelFetch(async () => { throw Error('DB unavailable') }, fixtureFetch(raw, false, 'application/json'))
    assert.equal(await (await broken('https://fixture.invalid', init)).text(), raw)
})
