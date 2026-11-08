const assert = require('node:assert/strict')
const { isDeepStrictEqual } = require('node:util')
const fs = require('node:fs')
const ts = require('typescript')

// 独立运行，避免依赖已删除的 tests/register.cjs。
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename)

const { parseSyntaxRepair, isSyntaxRepairable } = require('../src/agent/domain/syntaxRepair.ts')
const original = '[{"text":"扎啤","x":10,"richText":{"content":[{"text":"原文"}}]}]'
const repaired = '[{"text":"扎啤","x":10,"richText":{"content":[{"text":"原文"}]}}]'
assert.deepEqual(parseSyntaxRepair(original, repaired), JSON.parse(repaired))
assert.deepEqual(parseSyntaxRepair('{"a":1 "b":2,}', '{"a":1,"b":2}'), { a: 1, b: 2 })
for (const candidate of [repaired.replace('扎啤', '啤酒'), repaired.replace('10', '20'),
    repaired.replace('"x":10,', ''), repaired.replace('"x":10', '"x":10,"new":true'),
    repaired.replace('"text":"扎啤","x":10', '"x":10,"text":"扎啤"')]) {
    assert.throws(() => parseSyntaxRepair(original, candidate), /语法|内容/)
}
assert.throws(() => parseSyntaxRepair('{"a":1,"a":2,}', '{"a":1,"a":2}'), /语法|内容/)
assert.equal(isSyntaxRepairable('[{"text":"未结束'), false)
assert.equal(isSyntaxRepairable('[{"text":"缺闭合"}'), false)
assert.equal(isSyntaxRepairable('[{"text":未加引号}]'), false)
assert.equal(isSyntaxRepairable('[1,,2]'), false)
assert.equal(isSyntaxRepairable('[,1]'), false)
for (const text of ['[01]', '[-01]', '[truefalse]', '[nulltrue]', '[1e]']) assert.equal(isSyntaxRepairable(text), false)
assert.throws(() => parseSyntaxRepair('[9007199254740992,]', '[9007199254740993]'), /语法|内容/)
for (const candidate of ['[{"id":2},{"id":1}]', '[{"id":1}]', '[{"id":1},{"id":2},{"id":3}]']) {
    assert.throws(() => parseSyntaxRepair('[{"id":1},{"id":2}}', candidate), /语法|内容/)
}

console.log('syntax repair content guard passed')

const { createBoardToolContracts } = require('../src/agent/domain/tool.ts')
const { runAgent } = require('../src/agent/application/runAgent.ts')
const { createChatCompletionsModel } = require('../src/agent/adapters/model/chatCompletions.ts')
const contracts = createBoardToolContracts(['geo'])
const shape = { objectKey: 'label', type: 'geo', x: 10, y: 20, props: { color: 'black', richText: { type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '原文' }] }] } } }
const desiredShapes = [shape, { ...shape, x: 200 }]
const shapes = JSON.stringify(desiredShapes)
const badShapes = shapes.replace('"原文"}]', '"原文"}}')
assert.notEqual(shapes, badShapes)
const brief = { completionMode: 'write', goal: '创建标签', tasks: ['创建标签'],
    objects: [{ key: 'label', role: '标签', description: '一个标签' }], relations: [], constraints: [], unresolvedQuestions: [] }
const input = { runId: 'syntax-check', messages: [{ role: 'user', content: [{ type: 'text', source: 'user', text: '创建标签' }] }],
    initialSnapshot: { reference: { id: null, x: 0, y: 0 }, shapes: [] } }
const textResponse = text => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] })
const toolResponse = args => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
    tool_calls: [{ id: 'create_check', type: 'function', function: { name: 'create_shapes', arguments: args } }] } }] })

async function scenario({ candidates = [shapes], args = JSON.stringify({ shapes: badShapes, isFinal: true }), validate = () => [],
    repairFailure, sibling = false, repairAbort = false, repairSyntax, brokenCalls = 1 } = {}) {
    const requests = [], executed = [], events = [], controller = new AbortController()
    const adapter = createChatCompletionsModel({ contracts, config: { apiKey: 'synthetic', model: 'synthetic', baseUrl: 'https://test.invalid/v1' },
        fetcher: async (_url, init) => {
            const body = JSON.parse(init.body)
            requests.push(body)
            let data
            if (body.tools) {
                data = toolResponse(args)
                for (let index = 1; index < brokenCalls; index++) data.choices[0].message.tool_calls.push({
                    ...data.choices[0].message.tool_calls[0], id: `create_check_${index}`,
                })
                if (sibling) data.choices[0].message.tool_calls.unshift({ id: 'read_check', type: 'function',
                    function: { name: 'get_board_snapshot', arguments: '{"range":"viewport"}' } })
            } else {
                if (repairAbort) controller.abort()
                if (repairFailure) throw repairFailure
                data = textResponse(candidates.shift() ?? shapes)
            }
            return Response.json(data)
        },
    })
    const result = await runAgent(input, { tools: contracts.tools, model: { ...adapter,
        ...(repairSyntax ? { repairSyntax } : {}), prepare: async () => JSON.stringify({ kind: 'task', brief }) },
        signal: controller.signal, checkAccess: async () => {}, validate, record: async (type, data) => events.push({ type, ...data }),
        execute: async prepared => {
            executed.push(prepared)
            const call = prepared.call
            return { callId: call.id, name: call.name, state: 'known', output: call.name === 'get_board_snapshot'
                ? { ok: true, state: 'draft', range: 'viewport', truncated: false, snapshot: input.initialSnapshot }
                : { ok: true, state: 'draft', shapes: prepared.input.shapes.map((shape, index) => ({ id: `shape:check_${index}`, ...shape })) } }
        },
    })
    return { result, requests, executed, events }
}

async function main() {
    let check = await scenario()
    assert.equal(check.result.status, 'completed', JSON.stringify(check.result))
    assert.equal(check.requests.length, 2)
    assert.equal(check.executed.length, 1)
    assert.deepEqual(check.executed[0].call.input.shapes, desiredShapes)
    const request = check.requests[1]
    assert.equal(request.tools, undefined)
    assert.equal(request.tool_choice, undefined)
    assert.equal(request.messages.length, 2)
    assert.equal(request.messages[1].content, badShapes)
    assert(request.messages[0].content.includes('"type":"array"'))
    assert(!JSON.stringify(request.messages).includes('创建标签'))
    assert(check.events.some(event => event.operation === 'syntax_repair' && event.outcome === 'success'))

    check = await scenario({ candidates: [shapes.replace('black', 'blue'), shapes] })
    assert.equal(check.result.status, 'completed')
    assert.equal(check.requests.length, 3)
    assert.equal(check.executed[0].input.shapes[0].props.color, 'black')
    assert.equal(check.requests[2].messages[1].content, badShapes)
    assert(check.requests[2].messages[0].content.includes('上一轮'))

    check = await scenario({ candidates: [badShapes, badShapes], sibling: true })
    assert.equal(check.result.status, 'failed')
    assert.equal(check.requests.length, 3)
    assert.deepEqual(check.executed.map(call => call.call.name), ['get_board_snapshot'])
    assert(check.events.some(event => event.type === 'tool_result' && event.result.callId === 'create_check' && event.result.state === 'not_executed'))

    check = await scenario({ args: JSON.stringify({ shapes: shapes.slice(0, -1), isFinal: true }) })
    assert.equal(check.result.status, 'failed')
    assert.equal(check.requests.length, 1)
    assert.equal(check.executed.length, 0)

    check = await scenario({ brokenCalls: 3 })
    assert.equal(check.result.status, 'partial')
    assert.equal(check.requests.length, 3, '整个任务共用两次语法修复预算')
    assert.deepEqual(check.executed.map(call => call.call.id), ['create_check', 'create_check_1'])

    check = await scenario({ args: JSON.stringify({ shapes: badShapes.replace('"x":10', '"x":10001'), isFinal: true }),
        candidates: [shapes.replace('"x":10', '"x":10001')] })
    assert.equal(check.result.status, 'failed')
    assert.equal(check.requests.length, 2, '语法修复后的 Schema 错误不能重新生成业务参数')
    assert.equal(check.executed.length, 0)

    check = await scenario({ validate: () => [{ path: 'input.shapes[0].props', message: '原生属性无效' }] })
    assert.equal(check.result.status, 'failed')
    assert.equal(check.requests.length, 2) // 修复通过后原生校验失败，也不能进入整份参数重生成。
    assert.equal(check.executed.length, 0)

    check = await scenario({ args: JSON.stringify({ shapes: [shape], isFinal: true }) })
    assert.equal(check.result.status, 'completed')
    assert.equal(check.requests.length, 1)

    check = await scenario({ args: JSON.stringify({ shapes: [shape], isFinal: true }).replace('"isFinal":', '"isFinal" ') })
    assert.equal(check.result.status, 'failed') // 不允许补充有歧义的冒号。

    check = await scenario({ repairAbort: true })
    assert.equal(check.result.status, 'cancelled')
    assert.equal(check.executed.length, 0)
    check = await scenario({ repairFailure: new Error('connection failed') })
    assert.equal(check.requests.length, 2)
    assert.equal(check.executed.length, 0)

    // 外层参数同样支持本地语法修复，不能只修数组字符串。
    check = await scenario({ args: JSON.stringify({ shapes: [shape], isFinal: true }).replace(',"isFinal"', ' "isFinal"') })
    assert.equal(check.result.status, 'completed')
    assert.equal(check.requests.length, 1)
    check = await scenario({ args: JSON.stringify({ shapes: [shape], isFinal: true }).replace(',"isFinal"', ' "isFinal"'),
        validate: () => [{ path: 'input.shapes[0].props', message: '原生属性无效' }] })
    assert.equal(check.result.status, 'failed')
    assert.equal(check.requests.length, 1, '本地修复后校验失败也不能重生成业务参数')
    console.log('syntax repair adapter and execution checks passed')

    if (process.argv.includes('--live')) {
        require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} })
        const { readModelConfig } = require('../src/agent/adapters/model/client.ts')
        const config = readModelConfig()
        assert(config, '模型配置缺失')
        const live = createChatCompletionsModel({ config, contracts })
        let attempts = 0
        const { validateToolProperties } = require('../src/agent/adapters/board/nativeValidation.ts')
        check = await scenario({ validate: validateToolProperties, repairSyntax: async (problem, signal) => {
            attempts++
            const candidate = await live.repairSyntax(problem, AbortSignal.any([signal, AbortSignal.timeout(45000)]))
            try { parseSyntaxRepair(problem.text, candidate) }
            catch (error) {
                let returned = candidate, parseError
                try { returned = JSON.stringify(JSON.parse(candidate)) } catch (cause) { parseError = cause.message }
                const difference = [...shapes].findIndex((char, index) => char !== returned[index])
                console.log(JSON.stringify({ attempt: attempts, diagnostic: error.message, parseError, difference,
                    expected: shapes.slice(Math.max(0, difference - 25), difference + 100),
                    returned: returned.slice(Math.max(0, difference - 25), difference + 100), length: candidate.length }))
            }
            return candidate
        } })
        console.log(JSON.stringify({ live: true, attempts, status: check.result.status, simulatedWrites: check.executed.length,
            preserved: check.result.status === 'completed' && isDeepStrictEqual(check.executed[0].call.input.shapes, desiredShapes),
            error: check.result.error?.message }))
        assert.equal(check.result.status, 'completed', '真实修复模型未通过完整校验')
        assert.deepEqual(check.executed[0].call.input.shapes, desiredShapes)
    }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
