const assert = require('node:assert/strict')
const { test } = require('node:test')
const { getPreparationModes, rememberOutputCapability } = require('../src/agent/adapters/model/outputCapabilities.ts')

const config = { provider: 'qwen', apiKey: 'key', baseUrl: 'https://cache.test/v1', model: 'cache-model' }

test('capability observations expire and acceptance does not erase a different rejected mode', t => {
    let now = 1000
    t.mock.method(Date, 'now', () => now)
    assert.deepEqual(getPreparationModes(config), ['schema', 'object', 'prompt'])
    rememberOutputCapability(config, 'schema', 'unsupported')
    rememberOutputCapability(config, 'object', 'accepted')
    assert.deepEqual(getPreparationModes(config), ['object', 'prompt'])
    now += 3600000
    assert.deepEqual(getPreparationModes(config), ['schema', 'object', 'prompt'])
})

test('capabilities do not cross provider, model, gateway or credential configurations', () => {
    const original = { ...config, model: 'isolated' }
    rememberOutputCapability(original, 'schema', 'unsupported')
    rememberOutputCapability(original, 'object', 'unsupported')
    assert.deepEqual(getPreparationModes(original), ['prompt'])
    for (const change of [{ provider: 'openai' }, { model: 'other' }, { baseUrl: 'https://other.test/v1' }, { apiKey: 'other-key' }]) {
        assert.deepEqual(getPreparationModes({ ...original, ...change }), ['schema', 'object', 'prompt'])
    }
})

test('capability storage evicts old configurations instead of growing without a bound', () => {
    const first = { ...config, model: 'eviction-first' }
    rememberOutputCapability(first, 'schema', 'unsupported')
    for (let index = 0; index < 128; index++) rememberOutputCapability({ ...config, model: `eviction-${index}` }, 'schema', 'unsupported')
    assert.deepEqual(getPreparationModes(first), ['schema', 'object', 'prompt'])
})
