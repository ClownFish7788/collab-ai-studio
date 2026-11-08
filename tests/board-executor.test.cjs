require('../scripts/register-typescript.cjs')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { PrismaClient } = require('@prisma/client')
const { setupBoardChannel } = require('../scripts/setup-board-channel.cjs')
const { createBoardRunStore } = require('../src/agent/adapters/server/boardRunStore.ts')
const dir = mkdtempSync(path.join(tmpdir(), 'board-executor-'))
const client = new PrismaClient({ datasources: { db: { url: `file:${path.join(dir, 'test.db').replaceAll('\\', '/')}` } } })
const load = Module._load
let executor
try {
    Module._load = function (request, ...args) {
        if (request === '@/lib/prisma') return { __esModule: true, default: client }
        return load.call(this, request, ...args)
    }
    executor = require('../src/agent/adapters/server/browserExecutor.ts')
} finally { Module._load = load }
const call = { id: 'answer', name: 'ask_user', input: { questions: [{ id: 'color', question: '颜色？' }] } }
const output = { ok: true, answers: [{ id: 'color', text: '蓝色' }] }
const mapError = error => ({ code: 'TASK_FAILED', message: error.message })
test.after(async () => { await client.$disconnect(); assert.equal(path.dirname(dir), tmpdir()); rmSync(dir, { recursive: true, force: true }) })

test('real executor persists the call before emit and consumes a result submitted through the store', async () => {
    await setupBoardChannel(client, 'sqlite')
    const run = await executor.beginCreateRun('executor-owner', 'room', new AbortController().signal)
    try {
        const execute = executor.createBrowserToolExecutor({ run, mapError, onFailure: error => { throw error }, emit: async event => {
            const persisted = await client.boardAgentToolCall.findUnique({ where: { runId_callId: { runId: run.id, callId: event.call.id } } })
            assert.ok(persisted, 'registration must commit before browser can execute')
            await createBoardRunStore(client, 'sqlite').submit(run.id, 'executor-owner', event.call.id, output)
        } })
        const result = await execute({ call, input: call.input, elements: [] }, run.signal)
        assert.equal(result.state, 'known')
        assert.deepEqual(result.output, output)
    } finally { await executor.releaseCreateRun(run) }
})

test('cancel wakes the polling sleep and release removes both rows', async () => {
    await setupBoardChannel(client, 'sqlite')
    const controller = new AbortController()
    const run = await executor.beginCreateRun('cancel-owner', 'room', controller.signal)
    let emitted
    const ready = new Promise(resolve => { emitted = resolve })
    const execute = executor.createBrowserToolExecutor({ run, mapError, onFailure() {}, emit() { emitted() } })
    const pending = execute({ call, input: call.input, elements: [] }, run.signal)
    await ready
    controller.abort(new Error('test stop'))
    await assert.rejects(pending)
    await executor.releaseCreateRun(run)
    assert.equal(await client.boardAgentToolCall.count(), 0)
    assert.equal(await client.boardAgentRun.count(), 0)
})

test('ordinary tool timeout does not emit or replay a second invocation', async () => {
    const run = await executor.beginCreateRun('timeout-owner', 'room', new AbortController().signal)
    const read = { id: 'read', name: 'get_board_snapshot', input: { range: 'viewport' } }
    let count = 0
    const execute = executor.createBrowserToolExecutor({ run, mapError, waitMs: 10, onFailure() {}, emit() { count++ } })
    try {
        await assert.rejects(execute({ call: read, input: read.input, elements: [] }, run.signal), error => error.name === 'TimeoutError')
        assert.equal(count, 1)
    } finally { await executor.releaseCreateRun(run) }
})

test('a non-validation not_executed failure stops the application before another decision', async () => {
    const { runAgent } = require('../src/agent/application/runAgent.ts')
    const { boardToolContracts } = require('../src/agent/adapters/board/contracts.ts')
    let decisions = 0
    const error = { code: 'TASK_FAILED', message: 'channel unavailable' }
    const result = await runAgent({ runId: 'storage-failure', messages: [{ role: 'user', content: [{ type: 'text', source: 'user', text: '确认颜色' }] }] }, {
        tools: boardToolContracts, signal: new AbortController().signal, checkAccess: async () => {}, validate: () => [], mapError,
        model: {
            prepare: async () => JSON.stringify({ kind: 'task', brief: { completionMode: 'model', goal: '确认颜色', tasks: ['询问颜色'], objects: [], relations: [], constraints: [], unresolvedQuestions: ['颜色？'] } }),
            next: async () => { decisions++; return { kind: 'tool', calls: [{ ...call, id: `call-${decisions}` }] } },
        },
        execute: async ({ call }) => ({ callId: call.id, name: call.name, state: 'not_executed', error }),
    })
    assert.equal(decisions, 1)
    assert.equal(result.error.message, error.message)
    assert.deepEqual(result.uncertainCalls, [])
})
