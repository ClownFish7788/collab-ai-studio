const {test}=require('node:test');
const assert=require('node:assert/strict');
const Y=require('yjs');
const {initializeBoardV2,assertBoardV2,readLegacyBoard}=require('../src/utils/collaboration/tldrawYjsMigration');
const {shape,store,initialRecords}=require('./tldraw-yjs-fixtures.cjs');
test('fresh initialization creates one canonical page and document and is idempotent',()=>{
  const doc=new Y.Doc(),schema=store().schema;
  assert.equal(initializeBoardV2(doc,schema,{allowLegacy:false}),2);
  assertBoardV2(doc,schema);
  const original=doc.getMap('tl_records_v2').get('page:page');
  assert.equal(initializeBoardV2(doc,schema,{allowLegacy:false}),0);
  assert.equal(doc.getMap('tl_records_v2').get('page:page'),original);
  doc.destroy();
});
test('existing v1 requires explicit controlled migration and keeps its old root unchanged',()=>{
  const doc=new Y.Doc(),schema=store().schema,legacy=doc.getArray('tl_records');
  legacy.push(initialRecords().map(val=>({key:val.id,val})));
  const old=legacy.toJSON();
  assert.throws(()=>initializeBoardV2(doc,schema,{allowLegacy:false}),/升级|迁移/);
  assert.equal(doc.getMap('tl_records_v2').size,0);
  assert.equal(initializeBoardV2(doc,schema,{allowLegacy:true}),3);
  assert.deepEqual(legacy.toJSON(),old);
  assertBoardV2(doc,schema);
  doc.destroy();
});
test('legacy logical values use the rightmost duplicate without deleting raw backup data',()=>{
  const doc=new Y.Doc(),schema=store().schema;
  const records=initialRecords(),next={...shape(),x:50};
  doc.getArray('tl_records').push(records.map(val=>({key:val.id,val})).concat({key:next.id,val:next}));
  assert.equal(readLegacyBoard(doc).find(value=>value.id===next.id).x,50);
  initializeBoardV2(doc,schema,{allowLegacy:true});
  assert.equal(doc.getMap('tl_records_v2').get(next.id).get('placement').x,50);
  assert.equal(doc.getArray('tl_records').length,4);
  doc.destroy();
});
test('invalid old records fail before publishing v2 or a completion marker',()=>{
  const doc=new Y.Doc(),schema=store().schema;
  doc.getArray('tl_records').push([{key:shape().id,val:shape()}]);
  assert.throws(()=>initializeBoardV2(doc,schema,{allowLegacy:true}),/父|引用|页面/);
  assert.equal(doc.getMap('tl_records_v2').size,0);
  assert.notEqual(doc.getMap('tl_records_meta').get('format'),2);
  doc.destroy();
});
test('uncompleted v2 roots and incompatible schema versions are never overwritten',()=>{
  const doc=new Y.Doc(),schema=store().schema;
  doc.getMap('tl_records_v2').set('shape:partial',new Y.Map());
  assert.throws(()=>initializeBoardV2(doc,schema,{allowLegacy:true}),/未完成|不完整/);
  assert.equal(doc.getMap('tl_records_v2').has('shape:partial'),true);
  doc.destroy();
});
test('a valid initialized snapshot survives binary encode and reload with the same schema',()=>{
  const doc=new Y.Doc(),restored=new Y.Doc(),schema=store().schema;
  initializeBoardV2(doc,schema,{allowLegacy:false});
  Y.applyUpdate(restored,Y.encodeStateAsUpdate(doc));
  assertBoardV2(restored,schema);
  assert.equal(restored.getMap('tl_records_v2').size,2);
  doc.destroy();restored.destroy();
});

test('late v1 writes are detected again after a complete binary reload', () => {
  const doc = new Y.Doc(), restored = new Y.Doc(), schema = store().schema;
  doc.getArray('tl_records').push(initialRecords().map(val => ({ key: val.id, val })));
  initializeBoardV2(doc, schema, { allowLegacy: true });
  doc.getArray('tl_records').push([{ key: shape().id, val: { ...shape(), x: 77 } }]);
  Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
  assert.throws(() => assertBoardV2(restored, schema), /旧版本/);
  assert.equal(restored.getMap('tl_records_v2').get(shape().id).get('placement').x, 0);
  doc.destroy(); restored.destroy();
});
