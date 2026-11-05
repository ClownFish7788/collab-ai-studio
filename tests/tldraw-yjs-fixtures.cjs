const { Store } = require('@tldraw/store');
const { createTLSchema, DocumentRecordType, PageRecordType } = require('@tldraw/tlschema');
const Y = require('yjs');
const { createYRecord } = require('../src/utils/collaboration/tldrawYjsRecords');
function shape() { return {
  id: 'shape:test', typeName: 'shape', type: 'geo', parentId: 'page:page', index: 'a1',
  x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {},
  props: { w:100,h:100,geo:'rectangle',dash:'draw',growY:0,url:'',scale:1,color:'black',
    labelColor:'black',fill:'none',size:'m',font:'draw',align:'middle',verticalAlign:'middle',
    richText:{type:'doc',content:[{type:'paragraph'}]} },
}; }
function store() { return new Store({schema:createTLSchema()}); }
function initialRecords() { return [
  DocumentRecordType.create({id:'document:document'}),
  PageRecordType.create({id:'page:page',name:'Page',index:'a1'}),
  shape(),
]; }
function pair() {
  const docs=[new Y.Doc(),new Y.Doc()];
  for(const record of initialRecords()) docs[0].getMap('tl_records_v2').set(record.id,createYRecord(record));
  Y.applyUpdate(docs[1],Y.encodeStateAsUpdate(docs[0]));
  return docs;
}
function sync(docs) {
  const updates=docs.map(doc=>Y.encodeStateAsUpdate(doc));
  for(const doc of docs) for(const update of updates.concat([...updates].reverse())) Y.applyUpdate(doc,update);
}
module.exports={shape,store,initialRecords,pair,sync};
