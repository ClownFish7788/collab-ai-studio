const {test}=require('node:test');
const assert=require('node:assert/strict');
const {attachTldrawYjsHistory}=require('../src/utils/collaboration/tldrawYjsHistory');
const {bindTldrawYjs}=require('../src/utils/collaboration/bindTldrawYjs');
const {HistoryManager}=require('@tldraw/editor');
const {computed,transact}=require('@tldraw/state');
const {shape,store,pair,sync}=require('./tldraw-yjs-fixtures.cjs');
function editor(value) {
  let n=0;
  const history=new HistoryManager({store:value});
  const canUndo=computed('native-can-undo',()=>history.getNumUndos()>0);
  const canRedo=computed('native-can-redo',()=>history.getNumRedos()>0);
  return {store:value, history, complete(){return this;}, undo(){throw Error('native undo ran');},
    redo(){throw Error('native redo ran');}, getCanUndo(){return canUndo.get();},getCanRedo(){return canRedo.get();},
    canUndo(){return canUndo.get();},canRedo(){return canRedo.get();},clearHistory(){history.clear();return this;},
    markHistoryStoppingPoint(name){const id=name+':'+(++n);history._mark(id);return id;},getMarkIdMatching(){},
    bail(){throw Error('native bail ran');},bailToMark(){throw Error('native bail ran');},
    squashToMark(){return this;},getIsReadonly(){return false;},
  };
}
test('editor commands, grouping and cancellation all use guarded Yjs history',t=>{
  const docs=pair(),stores=[store(),store()],bindings=stores.map((s,i)=>bindTldrawYjs(s,docs[i].getMap('tl_records_v2')));
  const ed=editor(stores[0]),native=ed.undo,conflicts=[];
  const detach=attachTldrawYjsHistory(ed,bindings[0],()=>conflicts.push('conflict'));
  t.after(()=>{detach();bindings.forEach(b=>b.dispose());docs.forEach(d=>d.destroy());});
  const mark=ed.markHistoryStoppingPoint('drag');
  stores[0].put([{...shape(),x:10}]);
  stores[0].put([{...shape(),x:20}]);
  assert.equal(ed.getCanUndo(),true);
  ed.undo();assert.equal(stores[0].get('shape:test').x,0);
  ed.redo();assert.equal(stores[0].get('shape:test').x,20);
  ed.bailToMark(mark);assert.equal(stores[0].get('shape:test').x,0);
  assert.equal(ed.getCanRedo(),false);
  ed.markHistoryStoppingPoint('move');stores[0].put([{...shape(),x:40}]);sync(docs);
  stores[1].put([{...stores[1].get('shape:test'),x:80}]);sync(docs);
  ed.undo();assert.equal(stores[0].get('shape:test').x,80);assert.deepEqual(conflicts,['conflict']);
  detach();assert.equal(ed.undo,native);
});
test('readonly editor cannot replay history',t=>{
  const docs=pair(),value=store(),binding=bindTldrawYjs(value,docs[0].getMap('tl_records_v2'));
  const ed=editor(value),detach=attachTldrawYjsHistory(ed,binding,()=>{});
  t.after(()=>{detach();binding.dispose();docs.forEach(d=>d.destroy());});
  value.put([{...shape(),x:20}]);ed.getIsReadonly=()=>true;ed.undo();
  assert.equal(value.get('shape:test').x,20);
});

test('attaching shared history clears and stops native recording including native marks',t=>{
  const docs=pair(),value=store(),binding=bindTldrawYjs(value,docs[0].getMap('tl_records_v2'));
  const ed=editor(value),nativeHistory=ed.history;
  ed.markHistoryStoppingPoint('old');value.put([{...shape(),x:5}]);
  assert.ok(nativeHistory.getNumUndos()>0);
  const detach=attachTldrawYjsHistory(ed,binding,()=>{});
  t.after(()=>{detach();nativeHistory.dispose();binding.dispose();docs.forEach(d=>d.destroy());});
  const assertEmpty=()=>{
    const state=nativeHistory.debug();
    assert.equal(state.undos.length,0);assert.equal(state.redos.length,0);
    assert.equal(state.pendingDiff.isEmpty,true);
  };
  assertEmpty();
  ed.clearHistory();
  for(let x=10;x<=30;x+=10){
    const mark=ed.markHistoryStoppingPoint('move');
    assert.equal(ed.getMarkIdMatching('move'),mark);
    value.put([{...shape(),x}]);
  }
  assertEmpty();
  assert.equal(binding.undoManager.undoStack.length,3);
  ed.undo();assert.equal(value.get('shape:test').x,20);
  ed.redo();assert.equal(value.get('shape:test').x,30);
  assertEmpty();
});

test('toolbar queries cached before batched attachment follow shared history without native recording',async t=>{
  const docs=pair(),value=store(),binding=bindTldrawYjs(value,docs[0].getMap('tl_records_v2'));
  const ed=editor(value);
  const toolbarUndo=computed('toolbar-undo',()=>ed.getCanUndo());
  const toolbarRedo=computed('toolbar-redo',()=>ed.getCanRedo());
  assert.equal(toolbarUndo.get(),false);assert.equal(toolbarRedo.get(),false);
  const detach=transact(()=>attachTldrawYjsHistory(ed,binding,()=>{}));
  t.after(()=>{detach();ed.history.dispose();binding.dispose();docs.forEach(d=>d.destroy());});
  await Promise.resolve();
  ed.markHistoryStoppingPoint('move');value.put([{...shape(),x:25}]);
  assert.equal(toolbarUndo.get(),true);
  ed.undo();assert.equal(value.get('shape:test').x,0);
  assert.equal(toolbarUndo.get(),false);assert.equal(toolbarRedo.get(),true);
  ed.redo();assert.equal(value.get('shape:test').x,25);
  assert.equal(toolbarUndo.get(),true);assert.equal(toolbarRedo.get(),false);
  assert.equal(ed.history.debug().undos.length,0);assert.equal(ed.history.debug().redos.length,0);
});
