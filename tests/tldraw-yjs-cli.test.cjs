const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Y = require('yjs');
const { initialRecords, store } = require('./tldraw-yjs-fixtures.cjs');
const { assertBoardV2 } = require('../src/utils/collaboration/tldrawYjsMigration');

test('offline converter preserves the input backup, validates output and refuses overwrite', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-v2-'));
  const input = path.join(dir, 'input.yjs'), output = path.join(dir, 'output.yjs');
  t.after(() => { for (const file of [input, output]) fs.rmSync(file, { force: true }); fs.rmdirSync(dir); });
  const doc = new Y.Doc();
  doc.getArray('tl_records').push(initialRecords().map(val => ({ key: val.id, val })));
  const bytes = Y.encodeStateAsUpdate(doc);
  fs.writeFileSync(input, bytes);
  const run = () => spawnSync(process.execPath, ['scripts/migrate-tldraw-yjs-v2.cjs', input, output], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
  });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(new Uint8Array(fs.readFileSync(input)), bytes);
  const restored = new Y.Doc();
  Y.applyUpdate(restored, fs.readFileSync(output));
  assertBoardV2(restored, store().schema);
  const originalOutput = fs.readFileSync(output);
  assert.notEqual(run().status, 0);
  assert.deepEqual(fs.readFileSync(output), originalOutput);
  doc.destroy(); restored.destroy();
});
