const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildTraceFlow, traceStatus } = require('../src/utils/agent-traces/flow.ts')
const trace = { id: 'r1', kind: 'board', model: 'fixture', prompt: '画圆', input: '{}', status: 'completed', reply: '草稿已生成', createdAt: new Date(0).toISOString(), events: [] }
const event = (id, type, data, durationMs = null) => ({ id, type, data: JSON.stringify(data), durationMs })

test('flow pairs model/tool events and shows the actual correction path without inventing steps', () => {
    const nodes = buildTraceFlow({ ...trace, events: [
        event('m1', 'model_request', { requestId: 'm1', request: {} }),
        event('m1r', 'model_response', { requestId: 'm1', status: 'completed', content: '', toolCalls: [{}] }, 15),
        event('bad', 'tool_validation_error', { call: { function: { name: 'create_shapes' } }, willRetry: true }),
        event('m2', 'model_request', { requestId: 'm2', request: {} }),
        event('m2r', 'model_response', { requestId: 'm2', status: 'completed' }, 20),
        event('t1', 'tool_call', { call: { id: 'c1', function: { name: 'create_shapes' } } }),
        event('t1r', 'tool_result', { callId: 'c1', output: { ok: true, state: 'draft' } }, 5),
    ] })
    assert.deepEqual(nodes.map(n => n.kind), ['input', 'model', 'validation', 'model', 'tool', 'result'])
    assert.deepEqual(nodes[1].eventIds, ['m1', 'm1r'])
    assert.equal(nodes[1].durationMs, 15)
    assert.equal(nodes[2].status, 'failed')
    assert.deepEqual(nodes[4].eventIds, ['t1', 't1r'])
    assert.match(nodes[4].label, /草稿/)
    assert.equal(nodes[5].status, 'completed')
})

test('failed tools, pending calls and stale runs never look successful', () => {
    const nodes = buildTraceFlow({ ...trace, status: 'failed', events: [
        event('m1', 'model_request', { requestId: 'm1' }),
        event('m1e', 'model_error', { requestId: 'm1', httpStatus: 502 }),
        event('t1', 'tool_call', { call: { id: 'c1', function: { name: 'get_board_snapshot' } } }),
        event('t1e', 'tool_result', { callId: 'c1', output: { ok: false } }),
    ] })
    assert.equal(nodes[1].status, 'failed')
    assert.equal(nodes[2].status, 'failed')
    assert.equal(traceStatus({ status: 'running', createdAt: new Date(0).toISOString() }, 121000), 'interrupted')
    assert.equal(traceStatus({ status: 'running', createdAt: new Date(0).toISOString() }, 1000), 'running')
    const pending = buildTraceFlow({ ...trace, status: 'cancelled', events: [event('m1', 'model_request', { requestId: 'm1' })] })
    assert.equal(pending[1].status, 'interrupted')
})

test('unpaired or malformed historical events remain inspectable', () => {
    const nodes = buildTraceFlow({ ...trace, events: [event('orphan', 'tool_result', { callId: 'missing', output: { ok: false } }), { id: 'bad-json', type: 'run_error', data: '{', durationMs: null }] })
    assert.ok(nodes.some(n => n.eventIds.includes('orphan')))
    assert.ok(nodes.some(n => n.eventIds.includes('bad-json')))
})
