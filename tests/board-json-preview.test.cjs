const assert = require('node:assert/strict')
const { test } = require('node:test')

test('预览支持半个字符串、跨分片转义及 Unicode，不把内容里的括号当结构', () => {
    const { formatBoardJsonPreview } = require('../src/utils/board/agent/boardJsonPreview.ts')
    assert.match(formatBoardJsonPreview('preparation', '{"brief":{"goal":"画一个'), /目标：画一个/)
    const json = String.raw`{"brief":{"goal":"引号：\"，换行：\n，文字：\u4e2d\u6587，符号：{}[]","tasks":["读取","生成"]}}`
    for (let end = 0; end <= json.length; end++) assert.doesNotThrow(() => formatBoardJsonPreview('preparation', json.slice(0, end)))
    const preview = formatBoardJsonPreview('preparation', json)
    assert.match(preview, /引号："，换行：\n，文字：中文，符号：\{\}\[\]/)
    assert.match(preview, /读取/)
    assert.match(preview, /生成/)
})

test('元素表只展示完整行，未闭合行不被修复成可执行数据', () => {
    const { formatBoardJsonPreview } = require('../src/utils/board/agent/boardJsonPreview.ts')
    const row = JSON.stringify({ key: 'circle', operation: 'create', type: 'geo', known: { 'props.color': 'blue' }, missing: [] })
    const prefix = '{"elements":['
    assert.equal(formatBoardJsonPreview('tool', prefix + row.slice(0, -1)), '')
    assert.match(formatBoardJsonPreview('tool', prefix + row + ',{"key":"next'), /circle/)
    assert.doesNotMatch(formatBoardJsonPreview('tool', prefix + row + ',{"key":"next'), /next/)
})

test('非对象的表行不显示成空的完整行', () => {
    const { formatBoardJsonPreview } = require('../src/utils/board/agent/boardJsonPreview.ts')
    for (const field of ['elements', 'shapes']) assert.equal(formatBoardJsonPreview('tool', `{"${field}":["partial`), '')
    assert.equal(formatBoardJsonPreview('preparation', '{"brief":{"objects":["partial'), '')
})

test('预览事件拒绝未知来源、缺少起始标识和过大的分片', () => {
    const { validateBoardCreateEvent } = require('../src/utils/board/agent/boardCreateProtocol.ts')
    const event = { type: 'preview', runId: 'run-1', source: 'tool', delta: '{', start: true }
    assert.deepEqual(validateBoardCreateEvent(event), event)
    for (const changed of [{ source: 'execute' }, { start: undefined }, { delta: '' }, { delta: 'x'.repeat(10001) }]) {
        assert.throws(() => validateBoardCreateEvent({ ...event, ...changed }))
    }
})

test('未校验预览不进入后续对话历史', () => {
    const { toAgentHistory, toChatMessages } = require('../src/utils/chat/chatHistory.ts')
    const messages = [
        { role: 'user', content: '画圆' },
        { role: 'assistant', content: '本轮没有执行白板修改。', preview: '已经应用到正式白板', plan: '模型计划' },
    ]
    assert.deepEqual(toAgentHistory(messages), [{ prompt: '画圆', reply: '本轮没有执行白板修改。' }])
    assert.deepEqual(toChatMessages(messages), [{ role: 'user', content: '画圆', snapshot: undefined },
        { role: 'assistant', content: '本轮没有执行白板修改。', snapshot: undefined }])
})
