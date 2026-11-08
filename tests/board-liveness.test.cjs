require('../scripts/register-typescript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Y = require('yjs');
global.requestAnimationFrame = callback => { const timer = setTimeout(() => callback(performance.now()), 16); timer.unref(); return timer; };
global.cancelAnimationFrame = clearTimeout;
const NativeBroadcastChannel = global.BroadcastChannel;
global.BroadcastChannel = class extends NativeBroadcastChannel { constructor(name) { super(name); this.unref(); } };
const { createTLStore, defaultShapeUtils } = require('tldraw');
const { bindTldrawYjs, flushBoardChanges } = require('../src/utils/collaboration/bindTldrawYjs');
const migration = require('../src/utils/collaboration/tldrawYjsMigration');
const initializeBoard = migration.initializeBoard;
const clients = [];
function client(update, canWrite = () => true) {
  const doc = new Y.Doc(); if (update) Y.applyUpdate(doc, update);
  const store = createTLStore({ shapeUtils: defaultShapeUtils });
  initializeBoard(doc, store.schema, { allowLegacy: false });
  const root = doc.getMap(migration.BOARD_RECORDS);
  const binding = bindTldrawYjs(store, root, () => {}, canWrite);
  const result = { doc, store, root, binding }; clients.push(result); return result;
}
function closeAll() { while (clients.length) { const c = clients.pop(); c.binding.dispose(); c.doc.destroy(); } }
function shape(id, parentId = 'page:page', type = 'frame') {
  return { id: 'shape:' + id, typeName: 'shape', type, x: 10, y: 20, rotation: 0, index: 'a1', parentId, isLocked: false, opacity: 1, meta: {}, props: type === 'frame' ? { w: 320, h: 240, name: id, color: 'black' } : {} };
}
function edit(c, ...records) { c.binding.undoManager.stopCapturing(); c.store.put(records); flushBoardChanges(c.store); c.binding.undoManager.stopCapturing(); }
function sync(a, b) { const ua = Y.encodeStateAsUpdate(a.doc), ub = Y.encodeStateAsUpdate(b.doc); Y.applyUpdate(a.doc, ub, 'wire'); Y.applyUpdate(b.doc, ua, 'wire'); }
function setup() { const a = client(); edit(a, shape('P')); const original = a.root.get('shape:P'); const b = client(Y.encodeStateAsUpdate(a.doc)); return { a, b, original }; }

test('unseen child retains the same parent tree after undo and both delivery orders', t => {
  t.after(closeAll);
  for (const reverse of [false, true]) {
    const { a, b, original } = setup(); edit(b, shape('C', 'shape:P'));
    assert.equal(a.binding.undo(), true);
    assert.equal(a.store.has('shape:P'), false);
    assert.ok(a.root.get('shape:P') === original, 'undo must retain the original shared payload');
    let repairs = 0; a.doc.on('update', (_update, origin) => { if (origin !== 'wire') repairs++; });
    const ua = Y.encodeStateAsUpdate(a.doc), ub = Y.encodeStateAsUpdate(b.doc);
    if (reverse) { Y.applyUpdate(b.doc, ua, 'wire'); Y.applyUpdate(a.doc, ub, 'wire'); }
    else { Y.applyUpdate(a.doc, ub, 'wire'); Y.applyUpdate(b.doc, ua, 'wire'); }
    Y.applyUpdate(a.doc, ub, 'wire');
    for (const c of [a, b]) { assert.equal(c.binding.error, null); assert.equal(c.store.has('shape:P'), true); assert.equal(c.store.get('shape:C').parentId, 'shape:P'); }
    assert.equal(repairs, 0, 'projection must not publish compensation writes');
  }
});
test('late conflict retains only required ancestors of a multi-object undo', t => {
  t.after(closeAll); const a = client(); edit(a, shape('P'), shape('Q')); const b = client(Y.encodeStateAsUpdate(a.doc)); edit(b, shape('C', 'shape:P'));
  assert.equal(a.binding.undo(), true); sync(a, b);
  for (const c of [a,b]) { assert.equal(c.binding.error, null); assert.equal(c.store.has('shape:P'), true); assert.equal(c.store.has('shape:C'), true); assert.equal(c.store.has('shape:Q'), false); }
});
test('closed author and fresh reader recover from the merged binary without history', t => {
  t.after(closeAll); const {a,b} = setup(); edit(b, shape('C','shape:P')); const uploaded = Y.encodeStateAsUpdate(b.doc); b.binding.dispose(); b.doc.destroy();
  assert.equal(a.binding.undo(), true); Y.applyUpdate(a.doc, uploaded, 'wire');
  const fresh = client(Y.encodeStateAsUpdate(a.doc), () => false);
  assert.equal(fresh.binding.error, null); assert.equal(fresh.store.has('shape:P'), true); assert.equal(fresh.store.has('shape:C'), true); assert.equal(fresh.binding.undoManager.undoStack.length, 0);
});
test('known child still rejects the whole undo step', t => {
  t.after(closeAll); const {a,b} = setup(); edit(b, shape('C','shape:P')); sync(a,b); assert.equal(a.binding.undo(), false); assert.equal(a.store.has('shape:P'), true); assert.equal(a.binding.error, null);
});
test('own undo and redo work while independent remote fields survive', t => {
  t.after(closeAll); const {a,b} = setup(); edit(a, {...a.store.get('shape:P'),x:200}); sync(a,b); edit(b,{...b.store.get('shape:P'),props:{...b.store.get('shape:P').props,color:'red'}}); sync(a,b);
  assert.equal(a.binding.undo(),true); assert.equal(a.store.get('shape:P').x,10); assert.equal(a.store.get('shape:P').props.color,'red');
  assert.equal(a.binding.redo(),true); assert.equal(a.store.get('shape:P').x,200); assert.equal(a.store.get('shape:P').props.color,'red');
});

test('removing the final child hides retained ancestors and undo restores the same payload', t => {
  t.after(closeAll); const {a,b,original} = setup(); edit(b,shape('C','shape:P')); assert.equal(a.binding.undo(),true); sync(a,b);
  b.binding.undoManager.stopCapturing(); b.store.remove(['shape:C']); flushBoardChanges(b.store); b.binding.undoManager.stopCapturing();
  assert.equal(b.store.has('shape:P'),false); assert.equal(b.store.has('shape:C'),false);
  assert.equal(b.binding.undo(),true); assert.equal(b.store.has('shape:P'),true); assert.equal(b.store.has('shape:C'),true);
  sync(a,b); assert.ok(a.root.get('shape:P')===original); assert.equal(a.binding.error,null);
});
test('multi-level retained ancestry keeps local placement and rotation', t => {
  t.after(closeAll); const a=client(); edit(a,{...shape('P'),rotation:0.7},shape('R','shape:P')); const b=client(Y.encodeStateAsUpdate(a.doc)); edit(b,shape('C','shape:R'));
  assert.equal(a.binding.undo(),true); sync(a,b);
  assert.equal(a.store.get('shape:P').rotation,0.7); assert.equal(a.store.get('shape:C').x,10); assert.equal(a.store.get('shape:C').parentId,'shape:R'); assert.equal(a.store.has('shape:R'),true);
});
test('same-field remote edit blocks undo even when the external value returns', t => {
  t.after(closeAll); const {a,b}=setup(); edit(a,{...a.store.get('shape:P'),x:200}); sync(a,b);
  edit(b,{...b.store.get('shape:P'),x:300}); sync(a,b); edit(b,{...b.store.get('shape:P'),x:200}); sync(a,b);
  assert.equal(a.binding.undo(),false); assert.equal(a.store.get('shape:P').x,200);
});
test('one conflicting object rejects a whole multi-object step', t => {
  t.after(closeAll); const a=client();edit(a,shape('P'),shape('Q'));const b=client(Y.encodeStateAsUpdate(a.doc));edit(b,{...b.store.get('shape:Q'),props:{...b.store.get('shape:Q').props,color:'red'}});sync(a,b);
  assert.equal(a.binding.undo(),false);assert.equal(a.store.has('shape:P'),true);assert.equal(a.store.has('shape:Q'),true);
});
test('rejected local batches publish no partial payload and restore the Store', t => {
  t.after(closeAll);const a=client();const bytes=Y.encodeStateAsUpdate(a.doc);let updates=0;a.doc.on('update',()=>updates++);
  a.store.put([shape('Good'),shape('Bad','shape:missing')]);assert.throws(()=>flushBoardChanges(a.store));assert.equal(updates,0);assert.equal(a.store.has('shape:Good'),false);assert.deepEqual(Y.encodeStateAsUpdate(a.doc),bytes);
});
test('write permission is checked before payload materialization', t => {
  t.after(closeAll);const a=client(undefined,()=>false);a.store.put([shape('P')]);assert.throws(()=>flushBoardChanges(a.store),/权限/);assert.equal(a.root.has('shape:P'),false);assert.equal(a.store.has('shape:P'),false);
});
test('inactive materialization remains invisible and cannot pollute undo history', t => {
  t.after(closeAll);const a=client();const {createYRecord}=require('../src/utils/collaboration/tldrawYjsRecords');
  a.doc.transact(()=>a.root.set('shape:P',createYRecord(shape('P'))),'another-materializer');
  assert.equal(a.binding.error,null);assert.equal(a.store.has('shape:P'),false);assert.equal(a.binding.undoManager.undoStack.length,0);
  const fresh=client(Y.encodeStateAsUpdate(a.doc));assert.equal(fresh.store.has('shape:P'),false);
});
test('keep control data never leaks into native TLRecord', t => {
  t.after(closeAll);const a=client();edit(a,shape('P'));assert.equal(a.root.get('shape:P').get('keep'),true);assert.equal(Object.hasOwn(a.store.get('shape:P'),'keep'),false);
});
test('physical removal of a stable v3 record is rejected even without current dependents', t => {
  t.after(closeAll);const {a}=setup();a.doc.transact(()=>a.root.delete('shape:P'),'invalid-writer');assert.ok(a.binding.error,'physical deletion must invalidate v3 protocol');assert.equal(a.store.has('shape:P'),true);
});
test('live metadata changes cannot silently downgrade a v3 binding', t => {
  t.after(closeAll);const a=client();a.doc.getMap(migration.BOARD_META).set('format',2);assert.ok(a.binding.error);
});
test('malformed keep and active missing references fail closed', t => {
  t.after(closeAll);const {a}=setup();a.doc.transact(()=>a.root.get('shape:P').set('keep','yes'),'invalid-writer');assert.ok(a.binding.error);assert.equal(a.store.has('shape:P'),true);
  const c=client();const {createYRecord}=require('../src/utils/collaboration/tldrawYjsRecords');c.doc.transact(()=>c.root.set('shape:X',createYRecord(shape('X','shape:missing'),true)),'invalid-writer');assert.ok(c.binding.error);
});
test('cycles are rejected instead of being masked by ancestor projection', t => {
  t.after(closeAll);const a=client();edit(a,shape('P'),shape('Q'));a.doc.transact(()=>{a.root.get('shape:P').set('placement',{parentId:'shape:Q',x:0,y:0,rotation:0,index:'a1'});a.root.get('shape:Q').set('placement',{parentId:'shape:P',x:0,y:0,rotation:0,index:'a1'})},'invalid-writer');assert.ok(a.binding.error);assert.equal(a.store.get('shape:P').parentId,'page:page');
});
test('v2 upgrade is explicit, preserves old trees and detects late old writes after reload', t => {
  t.after(closeAll);const seed=client();edit(seed,shape('P'));const old=new Y.Doc(),root=old.getMap('tl_records_v2');const {createYRecord}=require('../src/utils/collaboration/tldrawYjsRecords');
  for(const record of seed.store.allRecords().filter(r=>['document','page','shape'].includes(r.typeName))){const value=createYRecord(record,true);value.delete('keep');root.set(record.id,value)}
  const meta=old.getMap(migration.BOARD_META);meta.set('format',2);meta.set('schema',seed.store.schema.serialize());meta.set('legacyBaseline',[]);const previous=root.get('shape:P');
  assert.throws(()=>initializeBoard(old,seed.store.schema,{allowLegacy:false}),/迁移/);assert.equal(meta.get('format'),2);
  initializeBoard(old,seed.store.schema,{allowLegacy:true});assert.ok(root.get('shape:P')===previous);assert.equal(meta.get('format'),3);
  const fresh=client(Y.encodeStateAsUpdate(old));assert.equal(fresh.store.has('shape:P'),true);
  old.getMap('tl_records_v2').get('shape:P').set('opacity',0.5);assert.throws(()=>migration.assertBoard(old,seed.store.schema),/旧版本/);assert.throws(()=>client(Y.encodeStateAsUpdate(old)),/旧版本/);old.destroy();
});
test('previous v2 cache is viewable read-only while unknown versions are rejected', t => {
  t.after(closeAll);const a=client();const {canLoadBoard,bindLegacyBoardReadOnly}=require('../src/utils/collaboration/legacyBoard');assert.equal(canLoadBoard(a.doc,false),true);
  const old=new Y.Doc();old.getMap(migration.BOARD_META).set('format',2);const {createYRecord}=require('../src/utils/collaboration/tldrawYjsRecords');for(const r of [...a.store.allRecords().filter(r=>['document','page'].includes(r.typeName)),shape('P')]){const v=createYRecord(r,true);v.delete('keep');old.getMap('tl_records_v2').set(r.id,v)}
  const view=createTLStore({shapeUtils:defaultShapeUtils});let error=null;const stop=bindLegacyBoardReadOnly(view,old,e=>error=e);assert.equal(error,null);assert.equal(view.has('shape:P'),true);stop();old.destroy();
  a.doc.getMap(migration.BOARD_META).set('format',999);assert.throws(()=>migration.readPreviousBoard(a.doc,a.store.schema),/不兼容/);
});
test('protocol admission isolates new rooms from old writers but permits new read-only clients on v2', () => {
  const {getBoardProtocolFailure}=require('../src/lib/boardRoomProtocol');assert.equal(getBoardProtocolFailure({boardProtocol:'3'},3),null);assert.equal(getBoardProtocolFailure({boardProtocol:'3'},2).status,409);assert.equal(getBoardProtocolFailure({boardProtocol:'2'},3),null);assert.equal(getBoardProtocolFailure({boardProtocol:'initializing'},3).status,503);assert.equal(getBoardProtocolFailure({boardProtocol:'3'},'3').status,409);
});

test('soft deletion of an ancestor does not block undoing the child creation', t => {
  t.after(closeAll);const {a,b}=setup();edit(b,shape('C','shape:P'));assert.equal(a.binding.undo(),true);sync(a,b);
  assert.equal(b.binding.undo(),true,'the parent payload identity is unchanged');assert.equal(b.store.has('shape:C'),false);assert.equal(b.store.has('shape:P'),false);sync(a,b);assert.equal(a.binding.error,null);assert.equal(a.store.has('shape:P'),false);
});
test('late independent descendants and parent fields merge without rebuilding any tree', t => {
  t.after(closeAll);const {a,b,original}=setup();const c=client(Y.encodeStateAsUpdate(a.doc));edit(b,{...b.store.get('shape:P'),props:{...b.store.get('shape:P').props,color:'red'}},shape('C','shape:P'));
  edit(c,{...c.store.get('shape:P'),props:{...c.store.get('shape:P').props,w:500}},shape('D','shape:P'));assert.equal(a.binding.undo(),true);sync(a,b);sync(a,c);sync(b,c);sync(a,b);
  for(const peer of[a,b,c]){assert.equal(peer.binding.error,null);assert.equal(peer.store.get('shape:P').props.color,'red');assert.equal(peer.store.get('shape:P').props.w,500);assert.equal(peer.store.has('shape:C'),true);assert.equal(peer.store.has('shape:D'),true)}assert.ok(a.root.get('shape:P')===original);
});
test('late image retains a deactivated asset dependency', t => {
  t.after(closeAll);const a=client();const asset={id:'asset:A',typeName:'asset',type:'image',props:{w:100,h:100,name:'test',isAnimated:false,mimeType:'image/png',src:null},meta:{}};edit(a,asset);const b=client(Y.encodeStateAsUpdate(a.doc));const {ImageShapeUtil}=require('tldraw');const image={...shape('image','page:page','image'),props:{...new ImageShapeUtil({}).getDefaultProps(),assetId:'asset:A'}};edit(b,image);assert.equal(a.binding.undo(),true);sync(a,b);assert.equal(a.binding.error,null);assert.equal(a.store.has('asset:A'),true);assert.equal(a.store.get('shape:image').props.assetId,'asset:A');
});
test('late binding retains its deactivated endpoint', t => {
  t.after(closeAll);const {a,b}=setup();const {ArrowShapeUtil}=require('tldraw');const arrow={...shape('arrow','page:page','arrow'),props:new ArrowShapeUtil({}).getDefaultProps()};const binding={id:'binding:test',typeName:'binding',type:'arrow',fromId:'shape:arrow',toId:'shape:P',props:{terminal:'end',normalizedAnchor:{x:0.5,y:0.5},isExact:false,isPrecise:true,snap:'none'},meta:{}};edit(b,arrow,binding);assert.equal(a.binding.undo(),true);sync(a,b);assert.equal(a.binding.error,null);assert.equal(a.store.has('binding:test'),true);assert.equal(a.store.has('shape:P'),true);
});
test('ordinary additions cannot reuse a hidden retained record identity', t => {
  t.after(closeAll);const a=client();edit(a,shape('P'));assert.equal(a.binding.undo(),true);let updates=0;a.doc.on('update',()=>updates++);a.store.put([shape('P')]);assert.throws(()=>flushBoardChanges(a.store),/冲突/);assert.equal(updates,0);assert.equal(a.store.has('shape:P'),false);assert.equal(a.root.get('shape:P').get('keep'),false);
});
test('room bootstrap publishes only after a v3 roundtrip and rejects a broken readback', async () => {
  const {createBoardRoom}=require('../src/lib/boardRoomProtocol');const server=new Y.Doc();let metadata, published=0,deleted=0;
  const remote={createRoom:async(_id,options)=>{metadata=options.metadata},getRoom:async()=>({metadata}),deleteRoom:async()=>{deleted++},sendYjsBinaryUpdate:async(_id,bytes)=>Y.applyUpdate(server,bytes),getYjsDocumentAsBinaryUpdate:async()=>Y.encodeStateAsUpdate(server),updateRoom:async(_id,options)=>{metadata=options.metadata}};
  await createBoardRoom(remote,'test','owner',async()=>{published++;assert.equal(server.getMap(migration.BOARD_META).get('format'),3);return 'published'});assert.equal(published,1);assert.equal(metadata.boardProtocol,'3');assert.equal(deleted,0);
  published=0;remote.getYjsDocumentAsBinaryUpdate=async()=>new Uint8Array([0,0]);await assert.rejects(createBoardRoom(remote,'broken','owner',async()=>{published++}));assert.equal(published,0);assert.equal(deleted,1);server.destroy();
});

test('activation delivered before payload waits safely and remote history remains empty', t => {
  t.after(closeAll);const a=client(),b=client(Y.encodeStateAsUpdate(a.doc)),updates=[];a.doc.on('update',update=>updates.push(update));edit(a,shape('P'));assert.equal(updates.length,2);
  Y.applyUpdate(b.doc,updates[1],'wire');assert.equal(b.binding.error,null);assert.equal(b.store.has('shape:P'),false);
  Y.applyUpdate(b.doc,updates[0],'wire');assert.equal(b.binding.error,null);assert.equal(b.store.has('shape:P'),true);assert.equal(b.binding.undoManager.undoStack.length,0);
});
test('AI formal application uses shared activation and rejected writes leave the draft active', t => {
  t.after(closeAll);let allowed=true;const a=client(undefined,()=>allowed);const {createBoardDraft,applyBoardDraft}=require('../src/agent/adapters/board/draft');const draft=createBoardDraft(a.store,'page:page');draft.scope.add('shape:P');draft.store.put([shape('P')]);assert.equal(a.store.has('shape:P'),false);
  allowed=false;assert.throws(()=>applyBoardDraft(draft,a.store),/权限/);assert.equal(draft.status,'active');assert.equal(a.root.has('shape:P'),false);
  allowed=true;applyBoardDraft(draft,a.store);assert.equal(draft.status,'applied');const original=a.root.get('shape:P');assert.equal(original.get('keep'),true);assert.equal(a.binding.undo(),true);assert.ok(a.root.get('shape:P')===original);assert.equal(a.store.has('shape:P'),false);assert.equal(a.binding.redo(),true);assert.equal(a.store.has('shape:P'),true);
});
test('offline converter roundtrips legacy data to v3 and refuses output overwrite', t => {
  t.after(closeAll);const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');const folder=fs.mkdtempSync(path.join(os.tmpdir(),'board-liveness-'));const input=path.join(folder,'input.yjs'),output=path.join(folder,'output.yjs');
  t.after(()=>{for(const file of[input,output])fs.rmSync(file,{force:true});fs.rmdirSync(folder)});
  const a=client();edit(a,shape('P'));const old=new Y.Doc();old.getArray('tl_records').push(a.store.allRecords().filter(r=>['document','page','shape'].includes(r.typeName)).map(val=>({key:val.id,val})));fs.writeFileSync(input,Y.encodeStateAsUpdate(old));old.destroy();
  const cli=path.resolve(__dirname,'../scripts/migrate-tldraw-yjs-v3.cjs');const run=spawnSync(process.execPath,[cli,input,output],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);const bytes=fs.readFileSync(output),fresh=client(bytes);assert.equal(fresh.store.has('shape:P'),true);assert.equal(fresh.doc.getMap(migration.BOARD_META).get('format'),3);
  const retry=spawnSync(process.execPath,[cli,input,output],{encoding:'utf8'});assert.notEqual(retry.status,0);assert.deepEqual(fs.readFileSync(output),bytes);
});
