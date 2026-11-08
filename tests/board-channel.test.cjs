require('../scripts/register-typescript.cjs')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { PrismaClient } = require('@prisma/client')
const { setupBoardChannel } = require('../scripts/setup-board-channel.cjs')
const { createBoardRunStore } = require('../src/agent/adapters/server/boardRunStore.ts')
const call = { id: 'call-1', type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ questions: [{ id: 'color', question: '颜色？' }] }) } }
const output = { ok: true, answers: [{ id: 'color', text: '蓝色' }] }

async function fixture(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'board-channel-'))
    const url = `file:${path.join(dir, 'test.db').replaceAll('\\', '/')}`
    const a = new PrismaClient({ datasources: { db: { url } } })
    const b = new PrismaClient({ datasources: { db: { url } } })
    t.after(async () => { await Promise.all([a.$disconnect(), b.$disconnect()]); rmSync(dir, { recursive: true, force: true }) })
    await setupBoardChannel(a, 'sqlite')
    await setupBoardChannel(a, 'sqlite')
    return { a, b, url, store: createBoardRunStore(a, 'sqlite'), other: createBoardRunStore(b, 'sqlite') }
}

test('a different process can submit the registered result, without shared JS state', async t => {
    const { store, url } = await fixture(t)
    await store.begin('run-1', 'owner', 'room', 180000)
    await store.register('run-1', call, 15000)
    const source = `
      require('./scripts/register-typescript.cjs');
      const { PrismaClient } = require('@prisma/client');
      const { createBoardRunStore } = require('./src/agent/adapters/server/boardRunStore.ts');
      const client = new PrismaClient({datasources:{db:{url:process.env.CHANNEL_TEST_URL}}});
      createBoardRunStore(client,'sqlite').submit('run-1','owner',${JSON.stringify(call.id)},${JSON.stringify(output)})
        .catch(e => { console.error(e); process.exitCode=1 }).finally(()=>client.$disconnect());
    `
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', source], { cwd: path.join(__dirname, '..'), env: { ...process.env, CHANNEL_TEST_URL: url }, stdio: ['ignore', 'ignore', 'pipe'] })
        let errors = ''; child.stderr.on('data', data => { errors += data })
        child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(errors)))
    })
    assert.deepEqual((await store.read('run-1', 'call-1')).output, output)
})

test('global owner exclusion, expiration replacement and old release preserve a new run', async t => {
    const { store, other, a } = await fixture(t)
    const starts = await Promise.allSettled([store.begin('a', 'owner', 'room', 180000), other.begin('b', 'owner', 'room', 180000)])
    assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1)
    const winner = starts.find(result => result.status === 'fulfilled').value
    await a.boardAgentRun.update({ where: { id: winner.id }, data: { expiresAt: new Date(0) } })
    await other.begin('new', 'owner', 'room', 180000)
    await store.release(winner.id)
    assert.equal((await store.owned('new', 'owner')).id, 'new')
    await store.begin('independent', 'other-owner', 'room', 180000)
})

test('idempotent retransmission, conflicting results, ownership and call matching', async t => {
    const { store, other } = await fixture(t)
    await store.begin('run', 'owner', 'room', 180000)
    await store.register('run', call, 15000)
    await assert.rejects(other.submit('run', 'stranger', call.id, output))
    await assert.rejects(other.submit('run', 'owner', 'unknown', output))
    await assert.rejects(other.submit('run', 'owner', call.id, { ok: true, answers: [{ id: 'wrong', text: 'red' }] }))
    await Promise.all([store.submit('run', 'owner', call.id, output), other.submit('run', 'owner', call.id, { answers: output.answers, ok: true })])
    await assert.rejects(other.submit('run', 'owner', call.id, { ...output, answers: [{ id: 'color', text: 'red' }] }))
    assert.deepEqual((await store.read('run', call.id)).output, output)
    await store.release('run')
    await assert.rejects(other.submit('run', 'owner', call.id, output))
})

test('late first result is rejected; accepted results remain readable after call deadline', async t => {
    const { store, a } = await fixture(t)
    await store.begin('run', 'owner', 'room', 180000)
    await store.register('run', call, 15000)
    await a.boardAgentToolCall.update({ where: { runId_callId: { runId: 'run', callId: call.id } }, data: { deadlineAt: new Date(0) } })
    await assert.rejects(store.submit('run', 'owner', call.id, output))
    await store.register('run', { ...call, id: 'accepted' }, 15000)
    await store.submit('run', 'owner', 'accepted', output)
    await a.boardAgentToolCall.update({ where: { runId_callId: { runId: 'run', callId: 'accepted' } }, data: { deadlineAt: new Date(0) } })
    assert.deepEqual((await store.read('run', 'accepted')).output, output)
    await store.submit('run', 'owner', 'accepted', output)
    await store.release('run')
    assert.equal(await a.boardAgentToolCall.count(), 0)
})
