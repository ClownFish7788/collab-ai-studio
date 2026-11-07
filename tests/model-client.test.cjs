const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readModelConfig, createModelClient, requestCompletion, ModelRequestError } = require('../src/agent/adapters/model/client.ts')
const { observeModelFetch } = require('../src/lib/modelTrace.ts')

const config = { apiKey: 'test-key', model: 'test-model', baseUrl: 'https://model.test/v1', provider: 'qwen' }
const input = { messages: [{ role: 'user', content: 'hello' }], outputLimit: 1024 }
const defaultSignal = new AbortController().signal
const sse = 'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
const response = () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } })

test('existing environment variables retain Qwen defaults and trim whitespace', () => {
    assert.deepEqual(readModelConfig({ API_KEY: ' key ', BASE_MODEL: ' model ', BASE_URL: ' https://model.test/v1 ' }), {
        apiKey: 'key', model: 'model', baseUrl: 'https://model.test/v1', provider: 'qwen',
    })
})

test('explicit OpenAI selection does not depend on a hostname', () => {
    assert.equal(readModelConfig({ API_KEY: 'key', BASE_MODEL: 'model', BASE_URL: 'https://gateway.test', MODEL_PROVIDER: ' openai ' }).provider, 'openai')
})

test('missing credentials or an unsupported provider cannot silently select a model service', () => {
    for (const env of [
        {}, { API_KEY: ' ', BASE_MODEL: 'model', BASE_URL: 'https://model.test' },
        { API_KEY: 'key', BASE_MODEL: 'model' },
        { API_KEY: 'key', BASE_MODEL: 'model', BASE_URL: 'https://model.test', MODEL_PROVIDER: 'typo' },
    ]) assert.equal(readModelConfig(env), null)
})

for (const [provider, expectedFields] of [
    ['qwen', { enable_thinking: false, max_tokens: 1024 }],
    ['openai', { max_completion_tokens: 1024 }],
]) test(`${provider} sends only its own token and thinking fields and preserves SSE bytes`, async () => {
    const settings = { ...config, provider }
    let request
    const client = createModelClient(settings, defaultSignal, async (url, init) => {
        request = { url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) }
        return response()
    })
    const result = await requestCompletion(client, settings, input, defaultSignal)
    assert.equal(request.url, 'https://model.test/v1/chat/completions')
    assert.equal(request.headers.get('authorization'), 'Bearer test-key')
    assert.deepEqual(request.body, { model: 'test-model', messages: input.messages, stream: true, ...expectedFields })
    assert.equal(result.headers.get('content-type'), 'text/event-stream')
    assert.equal(await result.text(), sse)
})

test('HTTP errors are safe, not retried, and cannot impersonate user access errors', async () => {
    for (const status of [401, 403, 429, 500]) {
        let calls = 0
        const client = createModelClient(config, defaultSignal, async () => {
            calls++
            return new Response(JSON.stringify({ error: { message: 'provider-secret-do-not-expose' } }), { status, headers: { 'content-type': 'application/json' } })
        })
        await assert.rejects(requestCompletion(client, config, input, defaultSignal), error => {
            assert.ok(error instanceof ModelRequestError)
            assert.equal(error.httpStatus, status)
            assert.equal(error.status, undefined)
            assert.match(error.message, new RegExp(`HTTP ${status}`))
            assert.ok(!JSON.stringify(error).includes('provider-secret'))
            assert.ok(!error.message.includes('provider-secret'))
            return true
        })
        assert.equal(calls, 1)
    }
})

test('connection errors are sanitized and never retried', async () => {
    let calls = 0
    const client = createModelClient(config, defaultSignal, async () => { calls++; throw new Error('sensitive-network-detail') })
    await assert.rejects(requestCompletion(client, config, input, defaultSignal), error => {
        assert.ok(error instanceof ModelRequestError)
        assert.equal(error.httpStatus, undefined)
        assert.ok(!error.message.includes('sensitive-network-detail'))
        return true
    })
    assert.equal(calls, 1)
})

test('response_format is forwarded without enabling transport retries', async () => {
    const response_format = { type: 'json_schema', json_schema: { name: 'test', strict: true, schema: { type: 'object' } } }
    let body
    const client = createModelClient(config, defaultSignal, async (_url, init) => { body = JSON.parse(init.body); return response() })
    await requestCompletion(client, config, { ...input, response_format }, defaultSignal)
    assert.deepEqual(body.response_format, response_format)
})

for (const [name, status, error, expected] of [
    ['explicit unsupported value', 400, { code: 'unsupported_value', param: 'response_format', message: "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model." }, 'unsupported_output_format'],
    ['unsupported format parameter', 400, { code: 'unsupported_parameter', param: 'response_format', message: "Unsupported parameter: 'response_format' is not supported with this model." }, 'unsupported_output_format'],
    ['compatible service without param', 400, { code: 'InvalidParameter', message: "response_format of type json_schema is not supported with this model" }, 'unsupported_output_format'],
    ['invalid schema', 400, { code: 'invalid_json_schema', param: 'response_format', message: 'Invalid schema: additionalProperties is required' }, 'invalid_schema'],
    ['schema keyword unsupported', 400, { code: 'unsupported_value', param: 'response_format.json_schema.schema', message: 'json_schema keyword is not supported' }, 'invalid_schema'],
    ['nested schema error without param', 400, { code: 'unsupported_parameter', message: "Unsupported parameter: 'response_format.json_schema.schema.patternProperties'." }, 'invalid_schema'],
    ['nested format configuration without param', 400, { code: 'unsupported_parameter', message: "Unsupported parameter: 'response_format.json_schema.name'." }, 'other'],
    ['malformed provider param', 400, { param: { path: 'response_format' }, message: 'response_format of type json_schema is not supported with this model' }, 'other'],
    ['thinking conflict', 400, { code: 'InvalidParameter', message: 'Json mode response is not supported when enable_thinking is true' }, 'other'],
    ['stream conflict', 400, { message: 'json_schema is not supported with stream enabled' }, 'other'],
    ['tools conflict', 400, { message: 'response_format is not supported with tools' }, 'other'],
    ['unrelated unsupported parameter', 400, { code: 'unsupported_parameter', param: 'temperature', message: 'temperature is not supported' }, 'other'],
    ['JSON prompt missing', 400, { code: 'InvalidParameter', message: 'messages must contain JSON when response_format is json_object' }, 'other'],
    ['unknown request error', 422, { code: 'InvalidParameter', message: 'invalid response_format' }, 'other'],
    ['authentication', 401, { code: 'unsupported_value', param: 'response_format', message: 'json_schema is not supported with this model' }, 'other'],
    ['service fault', 500, { code: 'unsupported_value', param: 'response_format', message: 'json_schema is not supported with this model' }, 'other'],
]) test(`format error classification: ${name}`, async () => {
    let calls = 0
    const client = createModelClient(config, defaultSignal, async () => {
        calls++
        return new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req-format-test' } })
    })
    await assert.rejects(requestCompletion(client, config, { ...input, response_format: { type: 'json_schema', json_schema: { name: 'test', schema: {} } } }, defaultSignal), cause => {
        assert.equal(cause.reason, expected)
        assert.ok(!cause.message.includes(error.message))
        assert.equal(cause.status, undefined)
        return true
    })
    assert.equal(calls, 1)
})

test('already cancelled requests do not reach the provider', async () => {
    let calls = 0
    const reason = new Error('cancelled by caller')
    const signal = AbortSignal.abort(reason)
    const client = createModelClient(config, signal, async () => { calls++; return response() })
    await assert.rejects(requestCompletion(client, config, input, signal), error => error === reason)
    assert.equal(calls, 0)
})

test('an in-flight request respects the caller timeout reason', async () => {
    let markStarted
    const started = new Promise(resolve => { markStarted = resolve })
    const controller = new AbortController()
    const client = createModelClient(config, controller.signal, async (_url, init) => {
        markStarted()
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
    })
    const pending = requestCompletion(client, config, input, controller.signal)
    await started
    const reason = new DOMException('deadline reached', 'TimeoutError')
    controller.abort(reason)
    await assert.rejects(pending, error => error === reason)
})

test('traced requests keep their own model, messages and response association', async () => {
    const traces = [[], []]
    await Promise.all(traces.map(async (events, index) => {
        const settings = { ...config, model: `model-${index}` }
        const tracedFetch = observeModelFetch(async (type, data) => events.push({ type, data }), async () => response())
        const client = createModelClient(settings, defaultSignal, tracedFetch)
        const result = await requestCompletion(client, settings, { ...input, messages: [{ role: 'user', content: `request-${index}` }] }, defaultSignal)
        assert.equal(await result.text(), sse)
    }))
    for (const [index, events] of traces.entries()) {
        const request = events.find(event => event.type === 'model_request').data
        const result = events.find(event => event.type === 'model_response').data
        assert.equal(request.request.model, `model-${index}`)
        assert.equal(request.request.messages[0].content, `request-${index}`)
        assert.equal(result.requestId, request.requestId)
        assert.equal(result.status, 'completed')
        assert.ok(!JSON.stringify(events).includes('test-key'))
    }
})
