const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { bindLegacyBoardReadOnly, canLoadBoard } = require('../src/utils/collaboration/legacyBoard');
const { shape, store, initialRecords } = require('./tldraw-yjs-fixtures.cjs');

test('known offline v1 data is displayable before cloud sync and unknown empty data is not', () => {
  const doc = new Y.Doc();
  assert.equal(canLoadBoard(doc, false), false);
  doc.getArray('tl_records').push(initialRecords().map(val => ({ key: val.id, val })));
  assert.equal(canLoadBoard(doc, false), true);
  doc.destroy();
});

test('legacy view follows v1 updates without creating a second write authority', () => {
  const doc = new Y.Doc(), value = store();
  doc.getArray('tl_records').push(initialRecords().map(val => ({ key: val.id, val })));
  const stop = bindLegacyBoardReadOnly(value, doc);
  assert.equal(value.get(shape().id).x, 0);
  doc.getArray('tl_records').push([{ key: shape().id, val: { ...shape(), x: 55 } }]);
  assert.equal(value.get(shape().id).x, 55);
  const raw = doc.getArray('tl_records').toJSON();
  value.put([{ ...shape(), x: 99 }]);
  assert.deepEqual(doc.getArray('tl_records').toJSON(), raw);
  assert.equal(doc.getMap('tl_records_v2').size, 0);
  stop(); doc.destroy();
});

test('legacy display does not run document-derived callbacks or echo them', () => {
  const doc = new Y.Doc(), value = store();
  doc.getArray('tl_records').push(initialRecords().map(val => ({ key: val.id, val })));
  const stop = bindLegacyBoardReadOnly(value, doc);
  const stopEffect = value.sideEffects.registerAfterChangeHandler('shape', (before, after) => {
    if (after.x === 5) value.put([{ ...after, props: { ...after.props, color: 'red' } }]);
  });
  doc.getArray('tl_records').push([{ key: shape().id, val: { ...shape(), x: 5 } }]);
  assert.equal(value.get(shape().id).props.color, 'black');
  stopEffect(); stop(); doc.destroy();
});
