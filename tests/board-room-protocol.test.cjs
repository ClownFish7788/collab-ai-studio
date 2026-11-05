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
  };
  await createBoardRoom(client, 'new-room');
  assert.deepEqual(calls, [['create', 'initializing'], ['write'], ['read'], ['admit', '2']]);
  assert.equal(doc.getMap('tl_records_v2').size, 2);
  doc.destroy();
});

test('existing room creation failure never writes or upgrades existing cloud data', async () => {
  let writes = 0;
  await assert.rejects(createBoardRoom({
    async createRoom() { throw new Error('already exists'); },
    async sendYjsBinaryUpdate() { writes++; },
  }, 'existing-room'), /already exists/);
  assert.equal(writes, 0);
});

test('failed read-back leaves new room closed for inspection', async () => {
  let admitted = false, writes = 0;
  await assert.rejects(createBoardRoom({
    async createRoom() {}, async sendYjsBinaryUpdate() { writes++; },
    async getYjsDocumentAsBinaryUpdate() { return Y.encodeStateAsUpdate(new Y.Doc()).buffer; },
    async updateRoom() { admitted = true; },
  }, 'failed-room'));
  assert.equal(admitted, false);
  assert.equal(writes, 1);
});

test('v2 admits only compatible clients and maintenance admits no clients', () => {
  assert.equal(getBoardProtocolFailure({}, undefined), null);
  assert.equal(getBoardProtocolFailure({ boardProtocol: '2' }, 2), null);
  assert.equal(getBoardProtocolFailure({ boardProtocol: '2' }, undefined).status, 409);
  assert.equal(getBoardProtocolFailure({ boardProtocol: 'initializing' }, 2).status, 503);
  assert.equal(getBoardProtocolFailure({ boardProtocol: '3' }, 2).status, 409);
});
