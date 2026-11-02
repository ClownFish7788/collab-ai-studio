const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('trace image API requires admin session, validates IDs and scopes private image reads', async () => {
  const originalLoad = Module._load
  const previousPassword = process.env.ADMIN_TRACE_PASSWORD
  const imageId = 'a'.repeat(64)
  const picture = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  let lookups = 0
  Module._load = function (id, ...args) {
    if (id === 'server-only') return {}
    if (id === '@/lib/traceAdminSession') return require('../src/lib/traceAdminSession.ts')
    if (id === '@/lib/prisma') return { agentTraceImage: { findFirst: async ({ where }) => {
      lookups++
      return where.traceId === 'test-trace' && where.id === imageId
        ? { mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,' + picture.toString('base64') } : null
    } } }
    return originalLoad.call(this, id, ...args)
  }
  try {
    process.env.ADMIN_TRACE_PASSWORD = 'synthetic-test-password-1234'
    const { createAdminSession, ADMIN_TRACE_COOKIE } = require('../src/lib/traceAdminSession.ts')
    const { GET } = require('../src/app/api/admin/agent-traces/[id]/images/[imageId]/route.ts')
    const params = (id = 'test-trace', image = imageId) => ({ params: Promise.resolve({ id, imageId: image }) })
    const noSession = await GET(new Request('http://localhost/image'), params())
    assert.equal(noSession.status, 401)
    assert.equal(lookups, 0)
    const request = new Request('http://localhost/image', { headers: { cookie: `${ADMIN_TRACE_COOKIE}=${createAdminSession(process.env.ADMIN_TRACE_PASSWORD)}` } })
    assert.equal((await GET(request, params('../outside'))).status, 400)
    assert.equal(lookups, 0)
    assert.equal((await GET(request, params('another-trace'))).status, 404)
    const response = await GET(request, params())
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/jpeg')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('vary'), 'Cookie')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), picture)
  } finally {
    Module._load = originalLoad
    if (previousPassword === undefined) delete process.env.ADMIN_TRACE_PASSWORD
    else process.env.ADMIN_TRACE_PASSWORD = previousPassword
  }
})
