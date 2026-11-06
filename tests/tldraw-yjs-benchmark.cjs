// In-memory comparison; excludes rendering, IndexedDB and real network latency.
require('./register.cjs');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { YKeyValue } = require('y-utility/y-keyvalue');
const { getIndexAbove } = require('@tldraw/utils');
const { bindTldrawYjs } = require('../src/utils/collaboration/bindTldrawYjs');
const { createYRecord } = require('../src/utils/collaboration/tldrawYjsRecords');
const { shape, store, initialRecords } = require('./tldraw-yjs-fixtures.cjs');

const shapes = 500, frames = 1000;
function run(mode) {
  const docs = [new Y.Doc(), new Y.Doc()], stores = [store(), store()], cleanups = [];
  let index = 'a1', bytes = 0, updates = 0;
  const records = initialRecords().filter(value => value.typeName !== 'shape');
  for (let i = 0; i < shapes; i++) {
    index = getIndexAbove(index);
    records.push({ ...shape(), id: `shape:bench-${i}`, index });
  }
  if (mode === 'v2') {
    for (const value of records) docs[0].getMap('tl_records_v2').set(value.id, createYRecord(value));
    Y.applyUpdate(docs[1], Y.encodeStateAsUpdate(docs[0]));
    stores.forEach((value, i) => { const binding = bindTldrawYjs(value, docs[i].getMap('tl_records_v2')); cleanups.push(() => binding.dispose()); });
  } else {
    const source = new YKeyValue(docs[0].getArray('tl_records'));
    for (const value of records) source.set(value.id, value);
    Y.applyUpdate(docs[1], Y.encodeStateAsUpdate(docs[0]));
    const target = new YKeyValue(docs[1].getArray('tl_records'));
    stores.forEach(value => value.put(records));
    cleanups.push(stores[0].listen(({ changes }) => {
      docs[0].transact(() => { for (const [, value] of Object.values(changes.updated)) source.set(value.id, value); });
    }, { source: 'user', scope: 'document' }));
    cleanups.push(stores[0].sideEffects.registerOperationCompleteHandler(() => stores[0]._flushHistory()));
    target.on('change', changes => {
      stores[1].mergeRemoteChanges(() => stores[1].put([...changes.keys()].map(id => target.get(id))));
    });
  }
  docs[0].on('update', update => { bytes += update.byteLength; updates++; Y.applyUpdate(docs[1], update); });
  const started = performance.now();
  for (let frame = 0; frame < frames; frame++) {
    const value = stores[0].get(`shape:bench-${frame % shapes}`);
    stores[0].put([{ ...value, x: value.x + 1, y: value.y + 1 }]);
  }
  const elapsedMs = performance.now() - started;
  assert.equal(updates, frames);
  assert.equal(stores[1].get('shape:bench-0').x, frames / shapes);
  assert.deepEqual(stores[0].serialize('document'), stores[1].serialize('document'));
  const result = { mode, shapes, frames, updateBytes: bytes, encodedDocBytes: Y.encodeStateAsUpdate(docs[0]).byteLength,
    localAndRemoteMs: Math.round(elapsedMs * 10) / 10 };
  cleanups.forEach(dispose => dispose()); docs.forEach(doc => doc.destroy());
  return result;
}
console.log(JSON.stringify({ node: process.version, results: [run('v1'), run('v2')] }, null, 2));
