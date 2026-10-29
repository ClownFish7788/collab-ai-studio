const { test } = require('node:test')
const assert = require('node:assert/strict')
const { classifyTraceError, eventOutcome } = require('../src/utils/agent-traces/outcomes.ts')

test('errors are classified from structured codes and operation boundaries rather than message wording', () => {
    const cases = [
        [{ name: 'TimeoutError', message: 'deadline' }, 'model_fetch', 'timeout'],
        [{ name: 'AbortError', message: 'stop' }, 'model_fetch', 'cancelled'],
        [{ detail: { code: 'INVALID_ARGUMENTS', message: 'invalid' } }, 'tool_execute', 'validation'],
        [{ detail: { code: 'INVALID_MODEL_RESPONSE', message: 'invalid' } }, 'model_call', 'model'],
        [{ detail: { code: 'EXECUTION_FAILED', message: 'failed' } }, 'tool_execute', 'tool'],
        [{ name: 'PrismaClientKnownRequestError', code: 'P2025', message: 'missing' }, 'access', 'storage'],
        [new Error('different wording'), 'request_validation', 'validation'],
        [new Error('different wording'), 'authentication', 'authentication'],
        [new Error('different wording'), 'access', 'permission'],
        [new Error('different wording'), 'draft_apply', 'draft'],
        [new Error('different wording'), 'stream_receive', 'protocol'],
        [new Error('different wording'), 'model_fetch', 'network'],
        [new Error('different wording'), 'unknown', 'internal'],
    ]
    for (const [cause, operation, category] of cases) {
        const error = classifyTraceError(cause, { operation })
        assert.equal(error.category, category)
        assert.ok(error.code)
        assert.ok(error.message)
    }
    assert.equal(classifyTraceError(undefined, { operation: 'model_fetch', httpStatus: 429 }).category, 'rate_limit')
    assert.equal(classifyTraceError(undefined, { operation: 'model_fetch', httpStatus: 401 }).category, 'configuration')
})

test('every completed operation has a result, pending calls and cancellations are not reported as success', () => {
    assert.equal(eventOutcome('model_request', {}).outcome, 'pending')
    assert.equal(eventOutcome('tool_call', {}).outcome, 'pending')
    assert.equal(eventOutcome('model_response', { status: 'completed' }).outcome, 'success')
    assert.equal(eventOutcome('model_response', { status: 'failed' }).errorCategory, 'model')
    assert.equal(eventOutcome('tool_result', { output: { ok: false, error: { code: 'EXECUTION_FAILED', message: 'bad' } } }).errorCategory, 'tool')
    assert.equal(eventOutcome('tool_validation_error', { error: { code: 'INVALID_ARGUMENTS', message: 'bad' }, willRetry: true }).outcome, 'error')
    assert.equal(eventOutcome('operation_result', { operation: 'draft_apply', outcome: 'success' }).outcome, 'success')
    assert.equal(eventOutcome('operation_result', { operation: 'draft_apply', outcome: 'cancelled' }).errorCategory, 'cancelled')
})
