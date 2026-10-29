const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-admin-'))
process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`
process.env.ADMIN_TRACE_PASSWORD = 'test-only-password-at-least-32-chars'
const db = new DatabaseSync(path.join(directory, 'test.db'))
db.exec(fs.readFileSync(path.join(__dirname, '../prisma/sqlite/agent-traces.sql'), 'utf8'))
db.close()
const prisma = require('../src/lib/prisma.ts').default
after(async () => { await prisma.$disconnect(); fs.rmSync(directory, { recursive: true, force: true }) })
const { createAdminSession, verifyAdminSession, matchesAdminPassword, sameOrigin } = require('../src/lib/traceAdminSession.ts')
const { POST, DELETE } = require('../src/app/api/admin/agent-traces/session/route.ts')
const { GET } = require('../src/app/api/admin/agent-traces/route.ts')
const { GET: detail } = require('../src/app/api/admin/agent-traces/[id]/route.ts')
const base = 'http://localhost:3000'
const request = (path, options = {}) => new Request(base + path, options)
const sessionRequest = password => request('/api/admin/agent-traces/session', {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ password }),
})

test('admin session fails closed for missing/short config, forgery, expiry and password rotation', () => {
    const password = process.env.ADMIN_TRACE_PASSWORD
    assert.equal(matchesAdminPassword('wrong', password), false)
    assert.equal(matchesAdminPassword('', ''), false)
    assert.equal(createAdminSession('short'), null)
    const token = createAdminSession(password, 1000)
    assert.equal(verifyAdminSession(token, password, 1001), true)
    assert.equal(verifyAdminSession(token + 'x', password, 1001), false)
    assert.equal(verifyAdminSession(token, password, 1000 + 8 * 3600_000), false)
    assert.equal(verifyAdminSession(token, 'rotated-password-at-least-16', 1001), false)
    assert.equal(verifyAdminSession(token, undefined, 1001), false)
})

test('trace list and detail reject anonymous, ordinary user and forged cookies', async () => {
    for (const cookie of ['', 'next-auth.session-token=ordinary-user', 'agent-trace-admin=forged']) {
        assert.equal((await GET(request('/api/admin/agent-traces', { headers: { cookie } }))).status, 401)
        assert.equal((await detail(request('/api/admin/agent-traces/x', { headers: { cookie } }), { params: Promise.resolve({ id: 'x' }) })).status, 401)
    }
})

test('origin validation uses the actual host when Next normalizes its internal request URL', () => {
    assert.equal(sameOrigin(new Request('http://localhost:3010/api/admin/agent-traces/session', {
        headers: { origin: 'http://127.0.0.1:3010', host: '127.0.0.1:3010' },
    })), true)
    assert.equal(sameOrigin(new Request('http://localhost:3010/api/admin/agent-traces/session', {
        headers: { origin: 'http://attacker.invalid', host: '127.0.0.1:3010' },
    })), false)
    const environment = process.env.NODE_ENV
    try {
        process.env.NODE_ENV = 'production'
        assert.equal(sameOrigin(new Request('http://internal/api/admin/agent-traces/session', {
            headers: { origin: 'https://admin.example.com', host: 'admin.example.com' },
        })), true)
        assert.equal(sameOrigin(new Request('http://internal/api/admin/agent-traces/session', {
            headers: { origin: 'http://admin.example.com', host: 'admin.example.com' },
        })), false)
    } finally {
        if (environment === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = environment
    }
})

test('independent login, pagination, detail and logout work with private no-store responses', async () => {
    assert.equal((await POST(sessionRequest('wrong'))).status, 401)
    assert.equal((await POST(request('/api/admin/agent-traces/session', { method: 'POST', headers: { origin: 'https://attacker.invalid' }, body: '{}' }))).status, 403)
    const login = await POST(sessionRequest(process.env.ADMIN_TRACE_PASSWORD))
    assert.equal(login.status, 200)
    const setCookie = login.headers.get('set-cookie')
    assert.match(setCookie, /HttpOnly/i)
    assert.match(setCookie, /SameSite=Strict/i)
    assert.doesNotMatch(setCookie, new RegExp(process.env.ADMIN_TRACE_PASSWORD))
    const cookie = setCookie.split(';')[0]
    for (let i = 0; i < 22; i++) await prisma.agentTrace.create({ data: { id: `r${String(i).padStart(2, '0')}`, kind: 'chat', model: 'fixture', prompt: `input-${i}`, input: '{}', createdAt: new Date(1000) } })
    const first = await GET(request('/api/admin/agent-traces', { headers: { cookie } }))
    assert.match(first.headers.get('cache-control'), /no-store/)
    const page = await first.json()
    assert.equal(page.items.length, 20)
    assert.ok(page.nextCursor)
    const second = await (await GET(request('/api/admin/agent-traces?cursor=' + page.nextCursor, { headers: { cookie } }))).json()
    assert.equal(second.items.length, 2)
    assert.equal(new Set([...page.items, ...second.items].map(i => i.id)).size, 22)
    const found = await detail(request('/api/admin/agent-traces/r01', { headers: { cookie } }), { params: Promise.resolve({ id: 'r01' }) })
    assert.equal((await found.json()).trace.prompt, 'input-1')
    const missing = await detail(request('/api/admin/agent-traces/missing', { headers: { cookie } }), { params: Promise.resolve({ id: 'missing' }) })
    assert.equal(missing.status, 404)
    assert.equal((await GET(request('/api/admin/agent-traces?cursor=%3Cscript%3E', { headers: { cookie } }))).status, 400)
    const logout = await DELETE(request('/api/admin/agent-traces/session', { method: 'DELETE', headers: { cookie, origin: base } }))
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i)
})

test('password attempts are throttled and an unset password never grants access', async () => {
    let response
    for (let i = 0; i < 21; i++) response = await POST(sessionRequest('wrong'))
    assert.equal(response.status, 429)
    assert.ok(Number(response.headers.get('retry-after')) > 0)
    const saved = process.env.ADMIN_TRACE_PASSWORD
    delete process.env.ADMIN_TRACE_PASSWORD
    assert.equal((await POST(sessionRequest(saved))).status, 503)
    process.env.ADMIN_TRACE_PASSWORD = saved
})

test('category filters retain corrected failures in successful runs and reject unknown filter values', async () => {
    const { startAgentTrace } = require('../src/lib/agentTrace.ts')
    const trace = await startAgentTrace({ id: 'recovered', kind: 'board', userId: 'u1', model: 'fixture', prompt: 'recovered', input: {} })
    await trace.record('tool_validation_error', { error: { code: 'INVALID_ARGUMENTS', message: 'bad width' }, willRetry: true })
    await trace.end('completed', 'fixed')
    const cookie = 'agent-trace-admin=' + createAdminSession(process.env.ADMIN_TRACE_PASSWORD)
    const response = await GET(request('/api/admin/agent-traces?category=validation&status=completed', { headers: { cookie } }))
    const data = await response.json()
    assert.deepEqual(data.items.map(i => i.id), ['recovered'])
    assert.equal(data.items[0].errorCount, 1)
    assert.equal((await GET(request('/api/admin/agent-traces?category=__proto__', { headers: { cookie } }))).status, 400)
    assert.equal((await GET(request('/api/admin/agent-traces?status=made-up', { headers: { cookie } }))).status, 400)
})
