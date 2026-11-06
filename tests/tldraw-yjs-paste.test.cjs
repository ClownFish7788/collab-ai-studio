const {test}=require('node:test');
const assert=require('node:assert/strict');
const {insertPastedImage}=require('../src/utils/collaboration/insertPastedImage');
const {bindTldrawYjs}=require('../src/utils/collaboration/bindTldrawYjs');
const {shape,store,pair}=require('./tldraw-yjs-fixtures.cjs');
test('each completed image paste has one independent undo step for its asset and shape',t=>{
 const docs=pair(),value=store(),binding=bindTldrawYjs(value,docs[0].getMap('tl_records_v2'));
 t.after(()=>{binding.dispose();docs.forEach(d=>d.destroy());});
 const editor={inputs:{getCurrentPagePoint:()=>({x:100,y:100})},
  markHistoryStoppingPoint(){binding.undoManager.stopCapturing();},run(fn){fn();},
  createAssets(records){value.put(records);},
  createShapes(records){value.put(records.map(r=>({...shape(),...r,props:{url:'',playing:true,altText:'',crop:null,flipX:false,flipY:false,...r.props}})));}};
 value.put([{...shape(),x:40}]);
 const paste=()=>insertPastedImage(editor,{src:'data:image/png;base64,AA==',w:10,h:20,name:'image',mimeType:'image/png'});
 paste();paste();
 assert.equal(binding.undoManager.undoStack.length,3);
 assert.equal(value.allRecords().filter(r=>r.typeName==='asset').length,2);
 assert.equal(binding.undo(),true);
 assert.equal(value.allRecords().filter(r=>r.typeName==='asset').length,1);
 assert.equal(binding.undo(),true);
 assert.equal(value.allRecords().filter(r=>r.typeName==='asset').length,0);
 assert.equal(value.get('shape:test').x,40);
 assert.equal(binding.undo(),true);assert.equal(value.get('shape:test').x,0);
});
