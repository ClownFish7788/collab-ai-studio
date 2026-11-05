const {test}=require('node:test');
const assert=require('node:assert/strict');
const {bindTldrawYjs}=require('../src/utils/collaboration/bindTldrawYjs');
const {shape,store,pair,sync}=require('./tldraw-yjs-fixtures.cjs');
function setup(t) {
  const docs=pair(),stores=[store(),store()];
  const bindings=stores.map((value,i)=>bindTldrawYjs(value,docs[i].getMap('tl_records_v2')));
  t.after(()=>{bindings.forEach(b=>b.dispose());docs.forEach(d=>d.destroy());});
  return {docs,stores,bindings};
}
test('undo my move retains another users later color, redo restores only my placement',t=>{
  const {docs,stores,bindings}=setup(t);
  stores[0].put([{...shape(),x:30,y:40}]);sync(docs);
  stores[1].put([{...stores[1].get('shape:test'),props:{...shape().props,color:'red'}}]);sync(docs);
  assert.equal(bindings[0].undoManager.undoStack.length,1);
  bindings[0].undo();sync(docs);
  assert.equal(stores[0].get('shape:test').x,0);
  assert.equal(stores[0].get('shape:test').props.color,'red');
  bindings[0].redo();sync(docs);
  assert.equal(stores[0].get('shape:test').x,30);
  assert.equal(stores[0].get('shape:test').props.color,'red');
});
test('undo does not overwrite a later remote edit of the same placement',t=>{
  const {docs,stores,bindings}=setup(t);
  stores[0].put([{...shape(),x:30,y:40}]);sync(docs);
  stores[1].put([{...stores[1].get('shape:test'),x:80,y:90}]);sync(docs);
  bindings[0].undo();sync(docs);
  assert.equal(stores[0].get('shape:test').x,80);
  assert.equal(stores[0].get('shape:test').y,90);
  assert.deepEqual(stores[0].serialize('document'),stores[1].serialize('document'));
});
test('remote and untracked local writes never become my undo entries',t=>{
  const {docs,stores,bindings}=setup(t);
  stores[1].put([{...shape(),x:99}]);sync(docs);
  docs[0].getMap('tl_records_v2').get('shape:test').set('meta',{system:true});
  assert.equal(bindings[0].undoManager.undoStack.length,0);
  bindings[0].undo();
  assert.equal(stores[0].get('shape:test').x,99);
});
test('one drag stays one undo even across frames, explicit boundaries split actions',t=>{
  const {stores,bindings}=setup(t),history=bindings[0].undoManager;
  for(let x=1;x<=20;x++) stores[0].put([{...shape(),x}]);
  assert.equal(history.undoStack.length,1);
  history.stopCapturing();
  stores[0].put([{...stores[0].get('shape:test'),props:{...shape().props,color:'red'}}]);
  assert.equal(history.undoStack.length,2);
  history.undo();
  assert.equal(stores[0].get('shape:test').x,20);
  assert.equal(stores[0].get('shape:test').props.color,'black');
});
test('offline undo continues to merge independent edits when reconnected',t=>{
  const {docs,stores,bindings}=setup(t);
  stores[0].put([{...shape(),x:10}]);
  stores[1].put([{...shape(),props:{...shape().props,color:'red'}}]);
  bindings[0].undo();sync(docs);
  assert.equal(stores[0].get('shape:test').x,0);
  assert.equal(stores[0].get('shape:test').props.color,'red');
  assert.deepEqual(stores[0].serialize('document'),stores[1].serialize('document'));
});
