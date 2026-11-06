const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bindTldrawYjs } = require('../src/utils/collaboration/bindTldrawYjs');
const { shape, store, pair, sync } = require('./tldraw-yjs-fixtures.cjs');
const frame = id => ({ ...shape(), id, type: 'frame', props: { w: 300, h: 200, name: '', color: 'black' } });
function setup(t) {
  const docs = pair(), stores = [store(), store()];
  const bindings = stores.map((value, i) => bindTldrawYjs(value, docs[i].getMap('tl_records_v2')));
  t.after(() => { bindings.forEach(value => value.dispose()); docs.forEach(value => value.destroy()); });
  return { docs, stores, bindings };
}

test('an empty top undo entry cannot fall through into an older conflicting step', t => {
  const { docs, stores, bindings } = setup(t);
  const other = { ...shape(), id: 'shape:other', index: 'a2' };
  stores[0].put([other]); sync(docs); bindings[0].undoManager.clear();
  stores[0].put([{ ...shape(), x: 13 }, { ...other, x: 13 }]); sync(docs);
  stores[1].put([{ ...stores[1].get(other.id), x: 50 }]); sync(docs);
  bindings[0].undoManager.stopCapturing();
  const temporary = { ...shape(), id: 'shape:temporary', index: 'a3' };
  stores[0].put([temporary]); stores[0].remove([temporary.id]);
  bindings[0].undo();
  assert.equal(stores[0].get(shape().id).x, 13);
  assert.equal(stores[0].get(other.id).x, 50);
  assert.equal(bindings[0].undo(), false);
});

test('one gesture remains one undo step across an independent remote edit', t => {
  const { docs, stores, bindings } = setup(t);
  stores[0].put([{ ...shape(), x: 10 }]); sync(docs);
  stores[1].put([{ ...stores[1].get(shape().id), props: { ...shape().props, color: 'red' } }]); sync(docs);
  stores[0].put([{ ...stores[0].get(shape().id), x: 20 }]);
  assert.equal(bindings[0].undoManager.undoStack.length, 1);
  assert.equal(bindings[0].undo(), true);
  assert.equal(stores[0].get(shape().id).x, 0);
  assert.equal(stores[0].get(shape().id).props.color, 'red');
});

test('a remote placement conflict in the middle of a gesture blocks the whole gesture', t => {
  const { docs, stores, bindings } = setup(t);
  stores[0].put([{ ...shape(), x: 10 }]); sync(docs);
  stores[1].put([{ ...stores[1].get(shape().id), x: 15 }]); sync(docs);
  stores[0].put([{ ...stores[0].get(shape().id), x: 20 }]);
  assert.equal(bindings[0].undo(), false);
  assert.equal(stores[0].get(shape().id).x, 20);
});

test('undo creation cannot orphan another users child moved into the new frame', t => {
  const { docs, stores, bindings } = setup(t), container = frame('shape:frame');
  stores[0].put([container]); sync(docs);
  stores[1].put([{ ...shape(), parentId: container.id }]); sync(docs);
  assert.equal(bindings[0].undo(), false);
  assert.equal(docs[0].getMap('tl_records_v2').has(container.id), true);
  assert.equal(bindings[0].error, null);
});

test('undo cannot restore references to a remotely replaced parent generation', t => {
  const { docs, stores, bindings } = setup(t), container = frame('shape:frame');
  stores[0].put([container]); sync(docs);
  stores[0].put([{ ...shape(), parentId: container.id }]); sync(docs);
  bindings[0].undoManager.clear();
  stores[0].put([{ ...shape(), x: 20 }]); sync(docs);
  stores[1].remove([container.id]);
  stores[1].put([container]); sync(docs);
  assert.equal(bindings[0].undo(), false);
  assert.equal(stores[0].get(shape().id).parentId, 'page:page');
});
