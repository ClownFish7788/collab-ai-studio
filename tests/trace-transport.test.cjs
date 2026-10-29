const { test } = require('node:test')
const assert = require('node:assert/strict')
// These transport fixtures are plain JSON; avoid booting the full editor runtime in Node.
const Module = require('node:module')
const load = Module._load
Module._load = function (name, ...args) { return name === 'tldraw' ? { isEqual: require('node:util').isDeepStrictEqual } : load.call(this, name, ...args) }
const { streamBoardCreateRun } = require('../src/utils/board/agent/streamBoardCreateRun.ts')
Module._load = load

test('browser tool exceptions are reported and sent as a valid failed result to the server', async () => {
    const reports = [], results = []
    const runId = crypto.randomUUID()
    const call = { id: 'read', type: 'function', function: { name: 'get_board_snapshot', arguments: '{"range":"viewport"}' } }
    const events = [{ type: 'started', runId }, { type: 'tool', runId, call }, { type: 'error', runId, error: { code: 'EXECUTION_FAILED', message: 'browser failed' } }]
    const fetcher = async (url, init) => {
        if (url === '/api/board-create') return new Response(events.map(e => JSON.stringify(e) + '\n').join(''), { headers: { 'Content-Type': 'application/x-ndjson', 'X-Agent-Trace-Id': runId } })
        if (url.endsWith('/result')) results.push(JSON.parse(init.body))
        else reports.push(JSON.parse(init.body))
        return Response.json({ accepted: true })
    }
    await assert.rejects(() => streamBoardCreateRun({ roomId: 'r', prompt: 'read' }, new AbortController().signal, async () => { throw Error('editor failed') }, () => {}, fetcher), /browser failed/)
    assert.equal(results[0].output.ok, false)
    assert.equal(results[0].output.error.code, 'EXECUTION_FAILED')
    assert.ok(reports.some(e => e.operation === 'tool_execute' && e.outcome === 'error' && e.error.message === 'editor failed'))
    assert.ok(reports.some(e => e.operation === 'result_submit' && e.outcome === 'success'))
})

test('valid browser flow returns its server run ID and reports stream success', async () => {
    const reports = [], runId = crypto.randomUUID()
    const events = [{ type: 'started', runId }, { type: 'completed', runId, text: 'done' }]
    const fetcher = async (url, init) => {
        if (url === '/api/board-create') return new Response(events.map(e => JSON.stringify(e) + '\n').join(''), { headers: { 'Content-Type': 'application/x-ndjson', 'X-Agent-Trace-Id': runId } })
        reports.push(JSON.parse(init.body)); return Response.json({ accepted: true })
    }
    const result = await streamBoardCreateRun({ roomId: 'r', prompt: 'hi' }, new AbortController().signal, () => { throw Error('unexpected tool') }, () => {}, fetcher)
    assert.equal(result.runId, runId)
    assert.ok(reports.some(e => e.operation === 'stream_receive' && e.outcome === 'success'))
})
