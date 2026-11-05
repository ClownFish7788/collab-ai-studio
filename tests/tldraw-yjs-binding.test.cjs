const {test}=require('node:test');
const assert=require('node:assert/strict');
const {bindTldrawYjs}=require('../src/utils/collaboration/bindTldrawYjs');
const {patchYRecord}=require('../src/utils/collaboration/tldrawYjsRecords');
const {shape,store,pair,sync}=require('./tldraw-yjs-fixtures.cjs');
function setup(t) {
  const docs=pair(),stores=[store(),store()];
  const bindings=stores.map((value,i)=>bindTldrawYjs(value,docs[i].getMap('tl_records_v2')));
  t.after(()=>{bindings.forEach(b=>b.dispose());docs.forEach(d=>d.destroy());});
  return {docs,stores,bindings};
}
test('two real stores retain move and color without echo writes',t=>{
  const {docs,stores}=setup(t);
  stores[0].put([{...shape(),x:50,y:70}]);
  stores[1].put([{...shape(),props:{...shape().props,color:'red'}}]);
  sync(docs);
  assert.equal(stores[0].get('shape:test').x,50);
  assert.equal(stores[0].get('shape:test').props.color,'red');
  assert.deepEqual(stores[0].serialize('document'),stores[1].serialize('document'));
  let changes=0;docs[0].on('update',()=>changes++);sync(docs);assert.equal(changes,0);
});
test('another local Yjs origin is applied, instance data is excluded',t=>{
  const {docs,stores}=setup(t);
  docs[0].transact(()=>patchYRecord(docs[0].getMap('tl_records_v2').get('shape:test'),shape(),{...shape(),x:9}),{other:true});
  assert.equal(stores[0].get('shape:test').x,9);
  assert.equal(docs[0].getMap('tl_records_v2').has('instance:instance'),false);
});
test('invalid remote batch keeps previous valid view and reports recoverable error',t=>{
  const {docs,stores,bindings}=setup(t);
  docs[0].getMap('tl_records_v2').get('shape:test').set('placement',{parentId:'shape:missing',x:0,y:0,rotation:0,index:'a1'});
  assert.equal(stores[0].get('shape:test').parentId,'page:page');
  assert.match(bindings[0].error.message,/父|引用/);
  assert.equal(docs[0].getMap('tl_records_v2').get('shape:test').get('placement').parentId,'shape:missing');
});
test('disposing removes observers and store write callbacks',t=>{
  const {docs,stores,bindings}=setup(t);
  bindings[0].dispose();
  stores[0].put([{...shape(),x:42}]);
  assert.equal(docs[0].getMap('tl_records_v2').get('shape:test').get('placement').x,0);
});
test('missing record update never recreates a deleted shape',t=>{
  const {docs,stores,bindings}=setup(t);
  docs[0].getMap('tl_records_v2').delete('shape:test');
  assert.equal(stores[0].get('shape:test'),undefined);
  assert.equal(docs[0].getMap('tl_records_v2').has('shape:test'),false);
  assert.equal(bindings[0].error,null);
});
