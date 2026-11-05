const {test}=require('node:test');
const assert=require('node:assert/strict');
const {attachTldrawYjsHistory}=require('../src/utils/collaboration/tldrawYjsHistory');
const {bindTldrawYjs}=require('../src/utils/collaboration/bindTldrawYjs');
const {shape,store,pair,sync}=require('./tldraw-yjs-fixtures.cjs');
function editor(value) {
  let n=0;
  return {store:value, complete(){return this;}, undo(){throw Error('native undo ran');},
    redo(){throw Error('native redo ran');}, getCanUndo(){return false;},getCanRedo(){return false;},
    canUndo(){return false;},canRedo(){return false;},clearHistory(){return this;},
    markHistoryStoppingPoint(name){return name+':'+(++n);},getMarkIdMatching(){},
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
