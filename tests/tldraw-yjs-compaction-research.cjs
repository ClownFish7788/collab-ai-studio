// Mechanism checks for the memory study, not a production compaction implementation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { initialRecords, shape, store } = require('./tldraw-yjs-fixtures.cjs');
const { createYRecord } = require('../src/utils/collaboration/tldrawYjsRecords');
const { bindTldrawYjs } = require('../src/utils/collaboration/bindTldrawYjs');

function setup(t) {
  const a = new Y.Doc(), b = new Y.Doc(); a.clientID = 10; b.clientID = 30;
  for (const value of initialRecords()) a.getMap('tl_records_v2').set(value.id, createYRecord(value));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const values = [store(), store()], docs = [a, b];
  const bindings = values.map((value, i) => bindTldrawYjs(value, docs[i].getMap('tl_records_v2')));
  t.after(() => { bindings.forEach(value => value.dispose()); docs.forEach(doc => doc.destroy()); });
  return { docs, values, bindings };
}
function gc(doc) { Y.tryGc(Y.createDeleteSetFromStructStore(doc.store), doc.store, doc.gcFilter); }
function converge(docs) {
  const updates = docs.map(doc => Y.encodeStateAsUpdate(doc));
  for (const doc of docs) for (const update of updates.concat([...updates].reverse())) Y.applyUpdate(doc, update);
  assert.deepEqual(docs[0].getMap('tl_records_v2').toJSON(), docs[1].getMap('tl_records_v2').toJSON());
}

test('clear releases undo retention but explicit GC is needed to reclaim old payload in this workload', t => {
  const { docs, values, bindings } = setup(t), a = docs[0];
  for (let x = 1; x <= 1000; x++) values[0].put([{ ...values[0].get(shape().id), x }]);
  const vector = Y.encodeStateVector(a), before = Y.encodeStateAsUpdate(a).byteLength;
  gc(a);
  assert.equal(Y.encodeStateAsUpdate(a).byteLength, before);
  assert.equal(bindings[0].canReplay(bindings[0].undoManager.undoStack.at(-1)), true);
  bindings[0].undoManager.clear();
  assert.equal(Y.encodeStateAsUpdate(a).byteLength, before);
  gc(a);
  assert.ok(Y.encodeStateAsUpdate(a).byteLength < before / 2);
  assert.deepEqual(Y.encodeStateVector(a), vector);
  assert.equal(values[0].get(shape().id).x, 1000);
});

test('identity-preserving GC still merges a stale offline independent edit and its local undo', t => {
  const { docs, values, bindings } = setup(t);
  for (let x = 1; x <= 100; x++) values[0].put([{ ...values[0].get(shape().id), x }]);
  bindings[0].undoManager.clear(); gc(docs[0]);
  values[1].put([{ ...shape(), props: { ...shape().props, color: 'red' } }]);
  converge(docs);
  assert.equal(values[0].get(shape().id).x, 100);
  assert.equal(values[0].get(shape().id).props.color, 'red');
  assert.equal(bindings[1].undo(), true);
  converge(docs);
  assert.equal(values[0].get(shape().id).x, 100);
  assert.equal(values[0].get(shape().id).props.color, 'black');
});

test('GC of a deleted record does not let a stale offline subtree edit resurrect it', t => {
  const { docs, values, bindings } = setup(t);
  values[0].remove([shape().id]); bindings[0].undoManager.clear(); gc(docs[0]);
  values[1].put([{ ...shape(), x: 99 }]);
  converge(docs);
  assert.equal(docs[0].getMap('tl_records_v2').has(shape().id), false);
  assert.equal(values[0].get(shape().id), undefined);
  assert.equal(values[1].get(shape().id), undefined);
});

test('a fresh JSON rebuild cannot be treated as a transparent GC replacement for an old offline edit', t => {
  const { docs, values } = setup(t), rebuilt = new Y.Doc(); rebuilt.clientID = 40;
  t.after(() => rebuilt.destroy());
  for (const record of Object.values(values[0].serialize('document'))) rebuilt.getMap('tl_records_v2').set(record.id, createYRecord(record));
  values[1].put([{ ...shape(), props: { ...shape().props, color: 'red' } }]);
  Y.applyUpdate(rebuilt, Y.encodeStateAsUpdate(docs[1]));
  assert.equal(rebuilt.getMap('tl_records_v2').get(shape().id).get('props').get('color'), 'black');
  assert.equal(values[1].get(shape().id).props.color, 'red');
});
