const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { createYRecord, decodeYRecord } = require('../src/utils/collaboration/tldrawYjsRecords');
const shape = () => ({
  id: 'shape:test', typeName: 'shape', type: 'geo', x: 0, y: 0, rotation: 0, index: 'a1',
  parentId: 'page:page', isLocked: false, opacity: 1, meta: { custom: true },
  props: { color: 'black', w: 100, h: 100, richText: { type: 'doc', content: [] } },
});
function record(doc) { return doc.getMap('records').get('shape:test'); }
test('all document record kinds round trip without losing fields', () => {
  const records = [shape(),
    { id: 'document:document', typeName: 'document', name: 'test', gridSize: 10, meta: {} },
    { id: 'page:page', typeName: 'page', name: 'Page', index: 'a1', meta: {} },
    { id: 'asset:test', typeName: 'asset', type: 'image', props: { src: 'x', w: 20 }, meta: {} },
    { id: 'binding:test', typeName: 'binding', type: 'arrow', fromId: 'shape:a', toId: 'shape:b', props: { terminal: 'end' }, meta: {} },
  ];
  for (const value of records) {
    const doc = new Y.Doc();
    doc.getMap('records').set(value.id, createYRecord(value));
    assert.deepEqual(decodeYRecord(doc.getMap('records').get(value.id)), value);
    doc.destroy();
  }
});
test('encoding and decoding do not share mutable JSON with callers', () => {
  const value = shape(), doc = new Y.Doc();
  doc.getMap('records').set(value.id, createYRecord(value));
  value.meta.custom = false;
  const result = decodeYRecord(record(doc));
  result.props.richText.content.push({ type: 'paragraph' });
  assert.equal(decodeYRecord(record(doc)).meta.custom, true);
  assert.deepEqual(decodeYRecord(record(doc)).props.richText.content, []);
});
