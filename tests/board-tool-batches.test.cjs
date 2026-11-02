const { test } = require('node:test')
const assert = require('node:assert/strict')
const { requestBoardCreateModel } = require('../src/lib/boardCreateModel.ts')
const { beginCreateRun, runCreateLoop, submitCreateResult } = require('../src/lib/boardCreateRun.ts')
const { createBoardToolRunner } = require('../src/utils/board/agent/executeBoardCreateTool.ts')
const { validateBoardToolCall, validateBoardToolOutput, toolOutputMatchesCall } = require('../src/utils/board/agent/boardCreateProtocol.ts')
const { streamBoardCreateRun } = require('../src/utils/board/agent/streamBoardCreateRun.ts')
const { requestBoardAnswer } = require('../src/utils/board/agent/boardAgentQuestion.ts')
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const snapshot = { reference: { id: null, x: 0, y: 0 }, shapes: [] }
const read = { ok: true, state: 'draft', range: 'viewport', snapshot, truncated: false }
const preparation = { kind: 'task', brief: { goal: '观察', tasks: ['观察'], objects: [], relations: [], constraints: [], unresolvedQuestions: [] } }

test('model assembles interleaved tool fragments into ordered calls', async () => {
  const chunks = [
    { role: 'assistant', tool_calls: [{ index: 1, id: 'b', type: 'function', function: { name: 'get_board_snapshot', arguments: '{"range":' } }] },
    { tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'get_board_snapshot', arguments: '{"range":"viewport"}' } }, { index: 1, function: { arguments: '"page"}' } }] },
  ].map(delta => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`).join('')
    + `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`
  let payload
  const result = await requestBoardCreateModel([], { apiKey: 'test', model: 'test', baseUrl: 'http://test' }, new AbortController().signal,
    ['get_board_snapshot'], async (_, init) => { payload = JSON.parse(init.body); return new Response(chunks, { headers: { 'content-type': 'text/event-stream' } }) })
  assert.deepEqual(result.calls.map(c => [c.id, JSON.parse(c.function.arguments).range]), [['a', 'viewport'], ['b', 'page']])
  assert.equal(payload.parallel_tool_calls, true)
})

test('parallel reads keep successful sibling and return exhausted error to model', async () => {
  const controller = new AbortController()
  const run = beginCreateRun(crypto.randomUUID(), 'test', controller.signal)
  const counts = new Map(), events = [], started = new Set()
  let badAttempts = 0
  const execute = createBoardToolRunner({ assertActive() {}, pageId: 'page:test', authorize() {}, read(range) {
    if (range === 'page') { badAttempts++; throw new Error('temporary read failure') }
    return read
  } })
  let round = 0, sawAllStarted = false
  await assert.rejects(runCreateLoop(run, { roomId: 'test', prompt: '观察画布' }, async messages => {
    if (!round++) return { kind: 'tool', calls: [call('good', 'get_board_snapshot', { range: 'viewport' }), call('bad', 'get_board_snapshot', { range: 'page' })] }
    const outputs = messages.filter(m => m.role === 'tool').map(m => [m.tool_call_id, JSON.parse(m.content)])
    assert.equal(outputs.length, 2)
    assert.equal(outputs[0][1].ok, true)
    assert.equal(outputs[1][1].ok, false)
    return { kind: 'text', text: '未修改' }
  }, async event => {
    events.push(event)
    if (event.type !== 'tool') return
    const id = event.call.id
    started.add(id)
    counts.set(id, (counts.get(id) || 0) + 1)
    await new Promise(resolve => setTimeout(resolve, id === 'good' ? 15 : 1))
    sawAllStarted ||= started.size === 2
    submitCreateResult(run.id, run.ownerId, id, await execute(event.call))
  }, async () => {}, async () => preparation), /白板读取失败/)
  assert.equal(sawAllStarted, true)
  assert.equal(counts.get('good'), 1)
  assert.equal(counts.get('bad'), 1)
  assert.equal(badAttempts, 3)
  controller.abort()
})

test('browser transport executes independent events without blocking the reader', async () => {
  const encoder = new TextEncoder(), started = [], posted = []
  let streamController
  const stream = new ReadableStream({ start(c) {
    streamController = c
    for (const event of [{ type: 'started', runId: 'batch' }, ...['one', 'two'].map(id => ({ type: 'tool', runId: 'batch', call: call(id, 'get_board_snapshot', { range: 'viewport' }) }))]) c.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
  } })
  const result = await streamBoardCreateRun({ roomId: 'test', prompt: '观察' }, new AbortController().signal, async c => {
    started.push(c.id)
    await new Promise(resolve => setTimeout(resolve, c.id === 'one' ? 15 : 1))
    assert.equal(started.length, 2)
    return read
  }, () => {}, async (url, init) => {
    if (url === '/api/board-create') return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } })
    if (url.endsWith('/result')) {
      posted.push(JSON.parse(init.body))
      if (posted.length === 2) { streamController.enqueue(encoder.encode(JSON.stringify({ type: 'completed', runId: 'batch', text: '已观察', results: [] }) + '\n')); streamController.close() }
    }
    return Response.json({ accepted: true })
  })
  assert.equal(result.results.length, 0)
  assert.deepEqual(posted.map(item => item.callId), ['two', 'one'])
})

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
test('read-only board observation returns model analysis with zero mutations', async () => {
  const controller = new AbortController(), run = beginCreateRun(crypto.randomUUID(), 'test', controller.signal)
  let round = 0, completed
  const analysis = '当前读取范围内没有元素；本轮未修改白板。'
  await runCreateLoop(run, { roomId: 'test', prompt: '截图看看整个页面有多少个元素，按形状分类' }, async () => {
    if (!round++) return { kind: 'tool', calls: [call('observe', 'get_board_snapshot', { range: 'viewport' })] }
    return { kind: 'text', text: analysis }
  }, event => {
    if (event.type === 'tool') submitCreateResult(run.id, run.ownerId, event.call.id, read)
    if (event.type === 'completed') completed = event
  }, async () => {}, async () => preparation)
  assert.equal(completed.text, analysis)
  assert.deepEqual(completed.results, [])
  controller.abort()
})

test('model prose without a board observation does not become an inspection result', async () => {
  const controller = new AbortController(), run = beginCreateRun(crypto.randomUUID(), 'test', controller.signal)
  let completed
  await runCreateLoop(run, { roomId: 'test', prompt: '统计页面元素' }, async () => ({ kind: 'text', text: '页面有500个元素' }),
    event => { if (event.type === 'completed') completed = event }, async () => {}, async () => preparation)
  assert.equal(completed.text, '本轮没有执行白板修改。')
  assert.deepEqual(completed.results, [])
  controller.abort()
})

test('screenshot result validates image/range and enters model context as image content', async () => {
  const c = call('photo', 'get_board_screenshot', { range: 'viewport' })
  assert.equal(validateBoardToolCall(c).function.name, 'get_board_screenshot')
  const photo = { ok: true, state: 'draft', range: 'viewport', image, reference: snapshot.reference, bounds: { x: 0, y: 0, w: 100, h: 100 } }
  assert.equal(toolOutputMatchesCall(c, validateBoardToolOutput(photo)), true)
  assert.throws(() => validateBoardToolOutput({ ...photo, image: 'not an image' }))
  const controller = new AbortController(), run = beginCreateRun(crypto.randomUUID(), 'test', controller.signal)
  let round = 0
  await runCreateLoop(run, { roomId: 'test', prompt: '看画布' }, async messages => {
    if (!round++) return { kind: 'tool', calls: [call('data', 'get_board_snapshot', { range: 'viewport' }), c] }
    assert.equal(messages.filter(m => m.role === 'tool').length, 2)
    assert(messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url' && p.image_url.url === image)))
    return { kind: 'text', text: '已查看' }
  }, event => { if (event.type === 'tool') submitCreateResult(run.id, run.ownerId, event.call.id, event.call.function.name === 'get_board_screenshot' ? photo : read) }, async () => {}, async () => preparation)
  controller.abort()
})

test('clarification accepts image-only and selected-ID answers; rejects empty payload', async () => {
  let question
  const controller = new AbortController()
  const waiting = requestBoardAnswer('请选择', controller.signal, value => { question = value }, () => {})
  question.submit({ text: '  ' })
  assert(question)
  question.submit({ images: [image] })
  assert.deepEqual(await waiting, { images: [image] })
  const value = { ok: true, answer: { selectedShapeIds: ['shape:selected'] }, snapshot: { ...snapshot, shapes: [] } }
  assert.throws(() => validateBoardToolOutput({ ok: true, answer: {} }))
  assert.deepEqual(validateBoardToolOutput({ ok: true, answer: { images: [image] } }).answer.images, [image])
  assert.throws(() => validateBoardToolOutput(value))
  controller.abort()
})

test('selected IDs are re-read from actual task editor and authorize only returned shapes', async () => {
  const selected = { id: 'shape:selected', type: 'geo', x: 2, y: 3, w: 100, h: 105, text: 'A', opacity: 1, color: 'blue', geo: 'rectangle' }
  const authorized = []
  const execute = createBoardToolRunner({ assertActive() {}, pageId: 'page:test', authorize: ids => authorized.push(...ids),
    ask: async () => ({ selectedShapeIds: [selected.id] }),
    readSelection: async ids => { assert.deepEqual(ids, [selected.id]); return { ...read, snapshot: { reference: { id: selected.id, x: 20, y: 30 }, shapes: [selected] } } },
  })
  const output = await execute(call('ask', 'ask_user', { question: '选哪个？' }))
  assert.equal(output.ok, true)
  assert.equal(output.snapshot.shapes[0].w, 100)
  assert.deepEqual(authorized, [selected.id])
})

test('read retries only failed attempts and caches successful result by call ID', async () => {
  let attempts = 0
  const retried = []
  const execute = createBoardToolRunner({ assertActive() {}, pageId: 'page:test', authorize() {}, onReadRetry: (_, attempt) => retried.push(attempt),
    read() { if (++attempts < 3) throw new Error('temporary'); return read },
  })
  const c = call('retry', 'get_board_snapshot', { range: 'viewport' })
  assert.equal((await execute(c)).ok, true)
  assert.equal((await execute(c)).ok, true)
  assert.equal(attempts, 3)
  assert.deepEqual(retried, [1, 2])
})

test('malformed arguments go to model immediately without browser execution', async () => {
  const controller = new AbortController(), run = beginCreateRun(crypto.randomUUID(), 'test', controller.signal)
  let round = 0, executed = 0
  await runCreateLoop(run, { roomId: 'test', prompt: '观察' }, async messages => {
    if (!round++) return { kind: 'tool', calls: [call('invalid', 'get_board_snapshot', { range: 'bad' }), call('valid', 'get_board_snapshot', { range: 'viewport' })] }
    if (round === 2) {
      const replies = messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content))
      assert.equal(replies[0].error.code, 'INVALID_ARGUMENTS')
      assert.equal(replies[1].ok, true)
      return { kind: 'tool', calls: [call('fixed', 'get_board_snapshot', { range: 'viewport' })] }
    }
    return { kind: 'text', text: '已观察' }
  }, event => { if (event.type === 'tool') { executed++; submitCreateResult(run.id, run.ownerId, event.call.id, read) } }, async () => {}, async () => preparation)
  assert.equal(executed, 2)
  controller.abort()
})

test('writes are ordered and final completion waits for all batch results', async () => {
  const controller = new AbortController(), run = beginCreateRun(crypto.randomUUID(), 'test', controller.signal)
  const events = [], order = []
  const shapes = [1, 2].map(i => ({ objectKey: `new_${i}`, role: '方块', type: 'geo', x: i * 100, y: 0, props: { geo: 'rectangle', w: 100, h: 100 } }))
  await runCreateLoop(run, { roomId: 'test', prompt: '画两个方块', snapshot }, async () => ({ kind: 'tool', calls: shapes.map((shape, i) => call(`write_${i}`, 'create_shapes', { shapes: [shape], isFinal: i === 1 })) }),
    async event => {
      events.push(event)
      if (event.type !== 'tool') return
      order.push(event.call.id)
      if (event.call.id === 'write_1') assert.deepEqual(order, ['write_0', 'done_0', 'write_1'])
      const native = JSON.parse(event.call.function.arguments).shapes[0]
      await new Promise(resolve => setTimeout(resolve, 2))
      submitCreateResult(run.id, run.ownerId, event.call.id, { ok: true, state: 'draft', shapes: [{ ...native, id: `shape:${event.call.id}` }] })
      order.push(event.call.id === 'write_0' ? 'done_0' : 'done_1')
    }, async () => {}, async () => preparation)
  assert.equal(events.at(-1).results.length, 2)
  assert.equal(events.at(-1).type, 'completed')
  controller.abort()
})

test('successful final write survives sibling read failure and read-only repair', async () => {
  const controller = new AbortController(), run = beginCreateRun(crypto.randomUUID(), 'test', controller.signal)
  let round = 0, writes = 0, reads = 0
  const shape = { objectKey: 'new', role: '方块', type: 'geo', x: 0, y: 0, props: { geo: 'rectangle', w: 100, h: 100 } }
  const events = []
  await runCreateLoop(run, { roomId: 'test', prompt: '画方块再观察', snapshot }, async () => {
    round++
    if (round === 1) return { kind: 'tool', calls: [call('write', 'create_shapes', { shapes: [shape], isFinal: true }), call('read_bad', 'get_board_snapshot', { range: 'viewport' })] }
    if (round === 2) return { kind: 'tool', calls: [call('read_fixed', 'get_board_snapshot', { range: 'viewport' })] }
    return { kind: 'text', text: '完成' }
  }, event => {
    events.push(event)
    if (event.type !== 'tool') return
    if (event.call.function.name === 'create_shapes') {
      writes++
      submitCreateResult(run.id, run.ownerId, event.call.id, { ok: true, state: 'draft', shapes: [{ ...JSON.parse(event.call.function.arguments).shapes[0], id: 'shape:new' }] })
    } else submitCreateResult(run.id, run.ownerId, event.call.id, ++reads === 1 ? { ok: false, error: { code: 'EXECUTION_FAILED', message: 'read failed' } } : read)
  }, async () => {}, async () => preparation)
  assert.equal(writes, 1)
  assert.equal(round, 2)
  assert.equal(events.at(-1).type, 'completed')
  controller.abort()
})

test('an invalid question still invalidates an earlier final write', async () => {
  const controller = new AbortController(), run = beginCreateRun(crypto.randomUUID(), 'test', controller.signal)
  let round = 0, completed = false
  const shape = { objectKey: 'new', role: '方块', type: 'geo', x: 0, y: 0, props: { geo: 'rectangle', w: 100, h: 100 } }
  await assert.rejects(runCreateLoop(run, { roomId: 'test', prompt: '画方块再询问', snapshot }, async () => {
    round++
    if (round === 1) return { kind: 'tool', calls: [call('write', 'create_shapes', { shapes: [shape], isFinal: true }), call('ask_bad', 'ask_user', { question: '' })] }
    if (round === 2) return { kind: 'tool', calls: [call('read_fixed', 'get_board_snapshot', { range: 'viewport' })] }
    return { kind: 'text', text: '完成' }
  }, event => {
    if (event.type === 'completed') completed = true
    if (event.type !== 'tool') return
    submitCreateResult(run.id, run.ownerId, event.call.id, event.call.function.name === 'create_shapes'
      ? { ok: true, state: 'draft', shapes: [{ ...JSON.parse(event.call.function.arguments).shapes[0], id: 'shape:new' }] } : read)
  }, async () => {}, async () => preparation), /任务只完成部分写入/)
  assert.equal(completed, false)
  controller.abort()
})
