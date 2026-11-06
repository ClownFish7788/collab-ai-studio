const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { createBoardRoom, getBoardProtocolFailure } = require('../src/lib/boardRoomProtocol');

test('new room stays gated until its initialized snapshot passes read-back validation', async () => {
  const doc = new Y.Doc(), calls = [];
  const client = {
    async createRoom(id, options) { calls.push(['create', options.metadata.boardProtocol]); },
    async sendYjsBinaryUpdate(id, update) { calls.push(['write']); Y.applyUpdate(doc, update); },
    async getYjsDocumentAsBinaryUpdate() { calls.push(['read']); return Y.encodeStateAsUpdate(doc).buffer; },
    async updateRoom(id, options) { calls.push(['admit', options.metadata.boardProtocol]); },
    async deleteRoom() { calls.push(['delete']); },
  };
  await createBoardRoom(client, 'new-room', 'owner', async () => { calls.push(['publish']); return { id: 'document' }; });
  assert.deepEqual(calls, [['create', 'initializing'], ['write'], ['read'], ['publish'], ['admit', '2']]);
  assert.equal(doc.getMap('tl_records_v2').size, 2);
  doc.destroy();
});

test('existing room creation failure never writes or upgrades existing cloud data', async () => {
  let writes = 0;
  await assert.rejects(createBoardRoom({
    async createRoom() { throw new Error('already exists'); },
    async sendYjsBinaryUpdate() { writes++; },
  }, 'existing-room', 'owner', async () => {}), /already exists/);
  assert.equal(writes, 0);
});

test('failed read-back removes only the unpublished new room and never publishes access', async () => {
  let admitted = false, writes = 0, cleanup = 0, published = false;
  await assert.rejects(createBoardRoom({
    async createRoom() {}, async sendYjsBinaryUpdate() { writes++; },
    async getYjsDocumentAsBinaryUpdate() { return Y.encodeStateAsUpdate(new Y.Doc()).buffer; },
    async updateRoom() { admitted = true; },
    async deleteRoom() { cleanup++; },
  }, 'failed-room', 'owner', async () => { published = true; }));
  assert.equal(admitted, false);
  assert.equal(writes, 1);
  assert.equal(cleanup, 1);
  assert.equal(published, false);
});

test('publication or admission failure can resume without replacing initialized shared trees', async () => {
  const doc = new Y.Doc();
  let metadata, writes = 0, failAdmission = true, row;
  const client = {
    async createRoom(id, options) {
      if (metadata) throw Object.assign(new Error('exists'), { status: 409 });
      metadata = options.metadata;
    },
    async getRoom() { return { metadata }; },
    async sendYjsBinaryUpdate(id, bytes) { writes++; Y.applyUpdate(doc, bytes); },
    async getYjsDocumentAsBinaryUpdate() { return Y.encodeStateAsUpdate(doc).buffer; },
    async updateRoom(id, options) { if (failAdmission) throw Error('temporary'); metadata = options.metadata; },
    async deleteRoom() { throw Error('published room must not be deleted'); },
  };
  const publish = async () => row ??= { id: 'published' };
  await assert.rejects(createBoardRoom(client, 'retry', 'owner', publish), /temporary/);
  const original = doc.getMap('tl_records_v2').get('page:page');
  failAdmission = false;
  assert.deepEqual(await createBoardRoom(client, 'retry', 'owner', publish), row);
  assert.equal(writes, 1);
  assert.equal(doc.getMap('tl_records_v2').get('page:page'), original);
  doc.destroy();
});

test('resuming another owners unfinished room cannot publish or change it', async () => {
  let published = false;
  await assert.rejects(createBoardRoom({
    async createRoom() { throw Object.assign(Error('exists'), { status: 409 }); },
    async getRoom() { return { metadata: { boardProtocol: 'initializing', boardBootstrapOwner: 'someone-else' } }; },
  }, 'other-room', 'owner', async () => { published = true; }), /exists/);
  assert.equal(published, false);
});

test('v2 admits only compatible clients and maintenance admits no clients', () => {
  assert.equal(getBoardProtocolFailure({}, undefined), null);
  assert.equal(getBoardProtocolFailure({ boardProtocol: '2' }, 2), null);
  assert.equal(getBoardProtocolFailure({ boardProtocol: '2' }, undefined).status, 409);
  assert.equal(getBoardProtocolFailure({ boardProtocol: 'initializing' }, 2).status, 503);
  assert.equal(getBoardProtocolFailure({ boardProtocol: '3' }, 2).status, 409);
});
