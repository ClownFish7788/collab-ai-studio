const assert = require('node:assert/strict')
const { test } = require('node:test')
const { preparationResponseFormat, normalizePreparationOutput } = require('../src/agent/adapters/model/preparationOutput.ts')
const { boardTaskPreparationSchema } = require('../src/agent/domain/task.ts')
const { boardTaskBriefPrompt } = require('../src/prompts/boardTaskBriefPrompt.ts')

const brief = {
    goal: '画一个矩形', tasks: ['创建矩形'],
    objects: [{ key: 'box', role: '矩形', description: '一个矩形', parentKey: null }],
    relations: [], constraints: [], unresolvedQuestions: [],
}
const normalize = value => JSON.parse(normalizePreparationOutput(JSON.stringify(value)))

test('preparation wire schema has a strict-compatible object root and required nullable fields', () => {
    assert.equal(preparationResponseFormat.type, 'json_schema')
    assert.equal(preparationResponseFormat.json_schema.strict, true)
    const schema = preparationResponseFormat.json_schema.schema
    assert.equal(schema.type, 'object')
    assert.equal(schema.oneOf, undefined)
    assert.equal(schema.anyOf, undefined)
    function check(value) {
        if (!value || typeof value !== 'object') return
        if (value.type === 'object') {
            assert.equal(value.additionalProperties, false)
            assert.deepEqual([...value.required].sort(), Object.keys(value.properties).sort())
        }
        for (const nested of Object.values(value)) {
            if (Array.isArray(nested)) nested.forEach(check)
            else check(nested)
        }
    }
    check(schema)
    assert.match(boardTaskBriefPrompt, /"brief":null/)
    assert.match(boardTaskBriefPrompt, /"text":null/)
})

test('wire task and reply normalize to the existing domain contracts', () => {
    const task = normalize({ kind: 'task', brief, text: null })
    assert.equal(boardTaskPreparationSchema.safeParse(task).success, true)
    assert.equal('parentKey' in task.brief.objects[0], false)
    assert.equal('text' in task, false)
    assert.deepEqual(normalize({ kind: 'reply', brief: null, text: '你好' }), { kind: 'reply', text: '你好' })
})

test('normalization retains unknown fields, wrong branch data and invalid references for domain validation', () => {
    for (const wire of [
        { kind: 'task', brief, text: 'unexpected' },
        { kind: 'reply', brief, text: '你好' },
        { kind: 'task', brief, text: null, extra: true },
        { kind: 'task', brief: { ...brief, objects: [{ ...brief.objects[0], extra: true }] }, text: null },
        { kind: 'task', brief: { ...brief, objects: [{ ...brief.objects[0], parentKey: 'missing' }] }, text: null },
        { kind: 'reply', brief: null, text: null },
    ]) assert.equal(boardTaskPreparationSchema.safeParse(normalize(wire)).success, false)
})

test('malformed JSON and legacy plain replies remain available to existing application correction', () => {
    for (const text of ['{"kind":', '你好', 'null', '[]', '"hello"']) {
        assert.equal(normalizePreparationOutput(text), text)
    }
    assert.deepEqual(normalize({ kind: 'reply', text: '你好' }), { kind: 'reply', text: '你好' })
})
