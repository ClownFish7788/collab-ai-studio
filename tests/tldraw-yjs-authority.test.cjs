const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bindTldrawYjs } = require('../src/utils/collaboration/bindTldrawYjs');
const { shape, store, pair, sync } = require('./tldraw-yjs-fixtures.cjs');
const { createBoardDraft, applyBoardDraft } = require('../src/agent/adapters/board/draft');
const frame = id => ({ ...shape(), id, type: 'frame', props: { w: 300, h: 200, name: '', color: 'black' } });
function setup(t) {
  const docs = pair(), stores = [store(), store()];
  const bindings = stores.map((value, i) => bindTldrawYjs(value, docs[i].getMap('tl_records_v2')));
  t.after(() => { bindings.forEach(value => value.dispose()); docs.forEach(value => value.destroy()); });
  return { docs, stores, bindings };
}

test('remote-derived document effects stay out of the shared state and local history', t => {
  const { docs, stores, bindings } = setup(t);
  let callbacks = 0;
  const stop = stores[1].sideEffects.registerAfterChangeHandler('shape', (before, after) => {
    callbacks++;
    if (after.x === 5 && after.props.color !== 'red') stores[1].put([{ ...after, props: { ...after.props, color: 'red' } }]);
  });
  t.after(stop);
  stores[0].put([{ ...shape(), x: 5 }]); sync(docs);
  assert.ok(callbacks > 0);
  assert.equal(bindings[1].undoManager.undoStack.length, 0);
  assert.equal(stores[1].get(shape().id).props.color, 'black');
  assert.equal(docs[1].getMap('tl_records_v2').get(shape().id).get('props').get('color'), 'black');
});

test('invalid identity in a batch cannot publish any earlier valid addition', t => {
  const { docs, stores, bindings } = setup(t);
  const added = { ...shape(), id: 'shape:new', index: 'a2' };
  stores[0].put([added, frame(shape().id)]);
  assert.equal(docs[0].getMap('tl_records_v2').has(added.id), false);
  assert.equal(bindings[0].undoManager.undoStack.length, 0);
  assert.equal(stores[0].get(added.id), undefined);
  assert.equal(stores[0].get(shape().id).type, 'geo');
});

test('formal AI submission fails visibly and stays active when binding rejects the write', t => {
  const docs = pair(), target = store();
  const binding = bindTldrawYjs(target, docs[0].getMap('tl_records_v2'), () => {}, () => false);
  t.after(() => { binding.dispose(); docs.forEach(doc => doc.destroy()); });
  const draft = createBoardDraft(target, 'page:page', [shape().id]);
  draft.store.put([{ ...shape(), x: 65 }]);
  assert.throws(() => applyBoardDraft(draft, target), /权限/);
  assert.equal(draft.status, 'active');
  assert.equal(target.get(shape().id).x, 0);
});
