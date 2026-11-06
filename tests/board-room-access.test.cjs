const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchesRoomAccess } = require('../src/utils/collaboration/roomAccess');
const useEditorStore = require('../src/app/store/useEditorStore').default;

test('only a completed check for this room and principal may reveal the editor', () => {
  const access = { roomId: 'a', principal: 'user-1', notFound: false };
  assert.equal(matchesRoomAccess(null, 'a', 'user-1'), false);
  assert.equal(matchesRoomAccess(access, 'a', 'user-1'), true);
  assert.equal(matchesRoomAccess(access, 'b', 'user-1'), false);
  assert.equal(matchesRoomAccess(access, 'a', 'user-2'), false);
});

test('switching room clears the previous roles authority', t => {
  const before = useEditorStore.getState();
  t.after(() => useEditorStore.setState(before));
  useEditorStore.getState().toggleId('a');
  useEditorStore.getState().setRole('owner');
  useEditorStore.getState().toggleId('b');
  assert.equal(useEditorStore.getState().role, null);
});
