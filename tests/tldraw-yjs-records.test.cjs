const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { createYRecord, patchYRecord, decodeYRecord } = require('../src/utils/collaboration/tldrawYjsRecords');
const shape = () => ({
  id: 'shape:test', typeName: 'shape', type: 'geo', x: 0, y: 0, rotation: 0, index: 'a1',
  parentId: 'page:page', isLocked: false, opacity: 1, meta: { custom: true },
  props: { color: 'black', w: 100, h: 100, richText: { type: 'doc', content: [] } },
});
function setup() {
  const a = new Y.Doc(), b = new Y.Doc();
  a.getMap('records').set('shape:test', createYRecord(shape()));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return [a, b];
}
function record(doc) { return doc.getMap('records').get('shape:test'); }
function sync(docs) {
  const updates = docs.map(doc => Y.encodeStateAsUpdate(doc));
  for (const doc of docs) for (const update of [...updates].reverse().concat(updates)) Y.applyUpdate(doc, update);
  assert.deepEqual(docs[0].getMap('records').toJSON(), docs[1].getMap('records').toJSON());
}
test('movement and independent color edit both survive', () => {
  const docs = setup(), before = shape();
  const parent = record(docs[0]), props = parent.get('props');
  patchYRecord(parent, before, { ...before, x: 90, y: 30 });
  patchYRecord(record(docs[1]), before, { ...before, props: { ...before.props, color: 'red' } });
  sync(docs);
  const result = decodeYRecord(record(docs[0]));
  assert.equal(result.x, 90); assert.equal(result.y, 30); assert.equal(result.props.color, 'red');
  assert.equal(record(docs[0]), parent); assert.equal(parent.get('props'), props);
  assert.equal(parent.has('x'), false);
});
test('competing placements retain a complete candidate including parent and index', () => {
  const docs = setup(), before = shape();
  const a = { ...before, x: 30, y: 40, rotation: 1, parentId: 'shape:frame', index: 'a2' };
  const b = { ...before, x: 90, y: 10, rotation: 2, index: 'a3' };
  patchYRecord(record(docs[0]), before, a);
  patchYRecord(record(docs[1]), before, b);
  sync(docs);
  const result = decodeYRecord(record(docs[0]));
  assert.ok([a, b].some(value => require('node:util').isDeepStrictEqual(value, result)));
});
test('deleting one prop preserves another concurrent edit and unchanged values emit no update', () => {
  const docs = setup(), before = shape(), after = structuredClone(before);
  delete after.props.richText;
  patchYRecord(record(docs[0]), before, after);
  patchYRecord(record(docs[1]), before, { ...before, props: { ...before.props, color: 'red' } });
  sync(docs);
  assert.equal(decodeYRecord(record(docs[0])).props.color, 'red');
  assert.equal(Object.hasOwn(decodeYRecord(record(docs[0])).props, 'richText'), false);
  let updates = 0;
  docs[0].on('update', () => updates++);
  patchYRecord(record(docs[0]), after, structuredClone(after));
  assert.equal(updates, 0);
});
test('deletion hides old subtree edits and explicit restoration uses a new tree', () => {
  const docs = setup(), stale = record(docs[1]);
  docs[0].getMap('records').delete('shape:test');
  patchYRecord(stale, shape(), { ...shape(), props: { ...shape().props, color: 'red' } });
  sync(docs);
  assert.equal(docs[0].getMap('records').has('shape:test'), false);
  docs[0].getMap('records').set('shape:test', createYRecord(shape()));
  stale.set('meta', { stale: true });
  sync(docs);
  assert.deepEqual(decodeYRecord(record(docs[0])), shape());
});
test('rejects non-document records and identity changes', () => {
  assert.throws(() => createYRecord({ typeName: 'instance', id: 'instance:instance' }));
  const [doc] = setup();
  assert.throws(() => patchYRecord(record(doc), shape(), { ...shape(), id: 'shape:other' }));
  record(doc).set('placement', { x: NaN });
  assert.throws(() => decodeYRecord(record(doc)));
});
