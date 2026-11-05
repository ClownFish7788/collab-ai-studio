const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBoardDraft, applyBoardDraft } = require('../src/agent/adapters/board/draft');
const { bindTldrawYjs } = require('../src/utils/collaboration/bindTldrawYjs');
const { shape, store, pair } = require('./tldraw-yjs-fixtures.cjs');

test('AI preview stays isolated and formal application immediately enters Yjs and local history', t => {
  const docs = pair(), target = store();
  const binding = bindTldrawYjs(target, docs[0].getMap('tl_records_v2'));
  t.after(() => { binding.dispose(); docs.forEach(doc => doc.destroy()); });
  const draft = createBoardDraft(target, 'page:page', ['shape:test']);
  draft.store.put([{ ...shape(), x: 65 }]);
  assert.equal(docs[0].getMap('tl_records_v2').get('shape:test').get('placement').x, 0);
  assert.equal(binding.undoManager.undoStack.length, 0);
  applyBoardDraft(draft, target);
  assert.equal(docs[0].getMap('tl_records_v2').get('shape:test').get('placement').x, 65);
  assert.equal(binding.undoManager.undoStack.length, 1);
  assert.equal(binding.undo(), true);
  assert.equal(target.get('shape:test').x, 0);
});
