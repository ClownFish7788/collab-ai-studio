const { test } = require('node:test')
const assert = require('node:assert/strict')
const { captureTraceImages, isTraceImageUrl, splitTraceImageUrls } = require('../src/utils/agent-traces/images.ts')
const { serializeTraceData, observeModelFetch } = require('../src/lib/modelTrace.ts')
const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const traceId = 'test-trace'
const imageId = 'a'.repeat(64)
const url = `/api/admin/agent-traces/${traceId}/images/${imageId}`

test('trace capture replaces repeated images including embedded JSON with one persisted reference', async () => {
  const original = { image: picture, messages: [{ content: JSON.stringify({ type: 'image_url', image_url: { url: picture } }) }] }
  const saved = []
  const result = await captureTraceImages(original, async image => { saved.push(image); return url })
  assert.equal(result.image, url)
  assert.equal(JSON.parse(result.messages[0].content).image_url.url, url)
  assert.equal(saved.length, 1)
  assert.equal(saved[0], picture)
  assert.equal(original.image, picture)
  assert.equal(JSON.parse(serializeTraceData(result)).image, url)
})

test('invalid or failed image storage remains omitted and does not abort trace recording', async () => {
  let saved = 0
  const result = await captureTraceImages({ bad: 'data:image/svg+xml;base64,PHN2Zz4=', good: picture }, async () => { saved++; throw new Error('storage unavailable') })
  assert.equal(saved, 1)
  assert.equal(result.bad, '[image omitted: image/svg+xml]')
  assert.equal(result.good, '[image omitted: image/png]')
})

test('only trace-scoped protected image URLs can produce preview controls', () => {
  assert.equal(isTraceImageUrl(url), true)
  for (const invalid of ['https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz4=', '/api/admin/agent-traces/a/images/../secret', url + '?extra=1']) assert.equal(isTraceImageUrl(invalid), false)
  const raw = JSON.stringify({ image: url, other: 'text' }, null, 2)
  const parts = splitTraceImageUrls(raw)
  assert.equal(parts.join(''), raw)
  assert.deepEqual(parts.filter(isTraceImageUrl), [url])
})

test('persisting a model-request image changes the trace copy only', async () => {
  let recorded, transmitted
  const fetcher = observeModelFetch(async (type, data) => {
    if (type === 'model_request') recorded = await captureTraceImages(data, async () => url)
  }, async (_, init) => {
    transmitted = JSON.parse(init.body)
    return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
  })
  const response = await fetcher('https://unused.invalid', { body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: picture } }] }] }) })
  await response.text()
  assert.equal(transmitted.messages[0].content[0].image_url.url, picture)
  assert.equal(recorded.request.messages[0].content[0].image_url.url, url)
})
